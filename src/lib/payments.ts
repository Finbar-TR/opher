import "server-only";
import { randomBytes } from "crypto";
import Stripe from "stripe";
import { stripe } from "./stripe";
import { prisma } from "./prisma";

// Every Stripe call the basket flow makes lives here.
//
// With no STRIPE_SECRET_KEY the module returns synthetic ids and reports success,
// so the whole join -> cutoff -> charge path is clickable locally without keys.
// This mirrors how the rest of the app already degrades.

const devId = (prefix: string) => `${prefix}_${randomBytes(9).toString("hex")}`;

// Reuse the user's Stripe Customer across joins; create it on the first one.
export async function ensureStripeCustomer(
  userId: string,
  email: string,
  name: string
): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const id = stripe
    ? (await stripe.customers.create({ email, name, metadata: { userId } })).id
    : devId("dev_cus");

  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: id } });
  return id;
}

// Tokenise a card without charging it. `usage: "off_session"` is what lets the
// cutoff cron charge later with no customer present.
export async function createSetupIntent(customerId: string): Promise<{
  id: string;
  clientSecret: string | null;
  devPaymentMethodId?: string;
}> {
  if (!stripe) {
    return {
      id: devId("dev_seti"),
      clientSecret: null,
      devPaymentMethodId: devId("dev_pm"),
    };
  }

  const si = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });
  return { id: si.id, clientSecret: si.client_secret };
}

// Our own credentials are broken — a rotated, revoked or under-permissioned
// API key. This is NOT a payment outcome and must never be recorded as one.
//
// It is also not the customer's problem, and treating it as a failed charge
// would be actively destructive: `failed` spends one of their three tries, so
// a botched deploy would burn every retry on every order and cancel the entire
// order book within days. Worse, it is a fact about the run rather than about
// any one order — if the key is wrong, nothing will work, so continuing to
// iterate orders can only cause damage.
//
// So it is thrown, not returned: it aborts the whole run, having touched
// nothing. A misconfigured deploy should do nothing rather than do harm.
export class PaymentConfigurationError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "PaymentConfigurationError";
    this.code = code;
  }
}

// Rethrow a credentials failure as the fatal error, from anywhere a Stripe call
// is made. Callers use this in their catch blocks so a run-level fault cannot
// be swallowed by per-order error isolation.
export function throwIfFatalConfig(err: unknown): void {
  if (err instanceof PaymentConfigurationError) throw err;

  if (
    err instanceof Stripe.errors.StripeAuthenticationError ||
    err instanceof Stripe.errors.StripePermissionError
  ) {
    throw new PaymentConfigurationError(
      `Stripe rejected our credentials (${err.type}): ${err.message}`,
      err.code
    );
  }
}

// What one charge attempt came to. `unknown` is the important one: the call
// threw without Stripe telling us anything about a PaymentIntent, so the money
// may or may not have moved. It is neither a success nor a failure and must
// never be collapsed into either — the reconciler establishes which it was by
// asking Stripe.
export type ChargeOutcome =
  | { kind: "succeeded"; paymentIntentId: string }
  | { kind: "failed"; paymentIntentId?: string; code?: string; message: string }
  | { kind: "requires_action"; paymentIntentId: string; code?: string; message?: string }
  | { kind: "processing"; paymentIntentId: string }
  | { kind: "unknown"; message: string }; // call threw — outcome undetermined

// Map a Stripe PaymentIntent status onto our outcome. Seven statuses, not two:
// `requires_action` and `processing` are neither success nor failure, and
// collapsing them into either is how a customer gets wrongly released or
// wrongly charged. This is the single source of truth for that mapping — the
// charge path, the reconciler and the webhook all resolve through it.
export function outcomeFromIntent(pi: Stripe.PaymentIntent): ChargeOutcome {
  switch (pi.status) {
    case "succeeded":
      return { kind: "succeeded", paymentIntentId: pi.id };
    case "requires_action":
      // Off-session, this is Stripe telling us the card needs the customer
      // present (`authentication_required`). Carry the reason through so the
      // attempt row records why, rather than just that.
      return {
        kind: "requires_action",
        paymentIntentId: pi.id,
        code: pi.last_payment_error?.code,
        message: pi.last_payment_error?.message,
      };
    case "processing":
      return { kind: "processing", paymentIntentId: pi.id };
    default:
      // canceled, requires_payment_method, requires_confirmation, requires_capture
      return {
        kind: "failed",
        paymentIntentId: pi.id,
        code: pi.last_payment_error?.code,
        message: pi.last_payment_error?.message ?? `Payment ${pi.status}`,
      };
  }
}

// Charge a saved card with nobody present. Failures are returned, not thrown —
// the cron records them as payment_failed and retries.
//
// `idempotencyKey` is stable per order per attempt (`order-<id>-attempt-<n>`),
// so the SDK's own network-level retry of a request that may already have
// landed at Stripe collapses into the original PaymentIntent instead of
// creating a second one. It protects the seconds around one call and nothing
// more: Stripe expires idempotency keys after 24 hours, and the only thing
// that revisits a stranded charge is the next daily cron — at or past that
// expiry. The reconciler, not the key, is what makes charging exactly-once.
//
// `orderId`/`attemptNumber` go into the PaymentIntent's metadata. That metadata
// is the entire reason an orphaned charge is findable later.
export async function chargeOrder(params: {
  orderId: string;
  attemptNumber: number;
  amountPence: number;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
}): Promise<ChargeOutcome> {
  if (!stripe) return { kind: "succeeded", paymentIntentId: devId("dev_pi") };

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountPence,
        currency: "gbp",
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          orderId: params.orderId,
          attemptNumber: String(params.attemptNumber),
        },
      },
      { idempotencyKey: params.idempotencyKey }
    );
    return outcomeFromIntent(pi);
  } catch (err) {
    return outcomeFromError(err);
  }
}

// Classify a thrown charge error. The only question that matters: could this
// error have left a PaymentIntent behind at Stripe?
//
//   * If Stripe handed back the intent it acted on, that IS its answer, and it
//     goes through `outcomeFromIntent` like any other intent rather than being
//     hand-assembled into a failure.
//   * If Stripe answered definitively that the request could not succeed —
//     malformed params, a payment method that no longer exists, a rejected key
//     — then no intent exists and the failure is ESTABLISHED. Calling that
//     `unknown` was its own trap: the reconciler would find nothing at Stripe,
//     abandon the attempt without spending a retry, and the order would be
//     re-attempted for ever while staying uncancellable.
//   * Anything else — a dropped socket, a timeout, a 500 from Stripe, a reused
//     idempotency key that may name an earlier intent — is genuinely
//     undetermined and must stay `unknown`. When in doubt, it is `unknown`:
//     the cost of that is a delay, and the cost of guessing wrong is a double
//     charge.
export function outcomeFromError(err: unknown): ChargeOutcome {
  if (err instanceof Stripe.errors.StripeError && err.payment_intent) {
    return outcomeFromIntent(err.payment_intent);
  }

  // Our credentials are wrong, not the customer's card. Nothing will work, so
  // nothing should be attempted — see `PaymentConfigurationError`.
  throwIfFatalConfig(err);

  const determined =
    err instanceof Stripe.errors.StripeCardError ||
    err instanceof Stripe.errors.StripeInvalidRequestError;

  if (determined) {
    const e = err as Stripe.errors.StripeError;
    return { kind: "failed", code: e.code, message: e.message };
  }

  // StripeAPIError (Stripe's own 500), StripeConnectionError, StripeRateLimitError
  // and StripeIdempotencyError all land here, along with anything non-Stripe.
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : "Charge outcome unknown",
  };
}

// Find the PaymentIntents Stripe holds for one order attempt.
//
// Uses `list`, not `search`: search's index lags roughly a minute, which is
// exactly the window being reconciled, so it can report "no payment" for one
// that exists — and "no payment" is the one answer that authorises another
// charge. `list` is immediately consistent; the metadata match is done here.
//
// Pages until Stripe says there is no more, and throws rather than returning a
// truncated list. An empty result means "Stripe holds nothing for this
// attempt", and the caller acts on that by charging again, so it must never be
// reachable by having simply stopped looking.
//
// `since`/`until` are BOUNDED AND ANCHORED ON THE ATTEMPT, not on the current
// time. The write-ahead ordering guarantees any intent was created within
// seconds of the attempt row, so a fixed window either side of it is both
// tighter and more correct than one that reaches back from now — and, because
// it never widens, it keeps the paging below bounded no matter how long an
// attempt has been waiting.
export async function findIntentsForAttempt(params: {
  customerId: string;
  orderId: string;
  attemptNumber: number;
  since: Date;
  until: Date;
}): Promise<Stripe.PaymentIntent[]> {
  if (!stripe) return [];

  const created = {
    gte: Math.floor(params.since.getTime() / 1000),
    lte: Math.ceil(params.until.getTime() / 1000),
  };
  const found: Stripe.PaymentIntent[] = [];
  let startingAfter: string | undefined;

  // 100 is Stripe's page maximum; ten pages of one customer's intents inside
  // the lookback window is already far beyond anything this app can produce.
  for (let page = 0; page < 10; page++) {
    const res = await stripe.paymentIntents.list({
      customer: params.customerId,
      limit: 100,
      created,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    found.push(
      ...res.data.filter(
        (pi) =>
          pi.metadata?.orderId === params.orderId &&
          pi.metadata?.attemptNumber === String(params.attemptNumber)
      )
    );

    if (!res.has_more || res.data.length === 0) return found;
    startingAfter = res.data[res.data.length - 1].id;
  }

  throw new Error(
    `[payments] customer ${params.customerId} has more PaymentIntents than the reconciler will page through; refusing to conclude anything about order ${params.orderId} attempt ${params.attemptNumber}`
  );
}

// The idempotency key is keyed on the intent, not the call site: two
// overlapping cron runs that both decide to refund the same duplicate charge
// collapse into one refund at Stripe instead of two. Without it the second
// caller either refunds again or errors, and an error here is reported as
// "refund manually" — the opposite of what happened.
export async function refundPaymentIntent(paymentIntentId: string): Promise<void> {
  if (!stripe) return;
  await stripe.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund-${paymentIntentId}` }
  );
}

// Cancel an intent we are giving up on, and report what Stripe says it became.
//
// An intent left at `requires_action` is still alive: the customer could
// authenticate hours later and it would succeed, after we had already recorded
// a failure and charged again under the next attempt. Cancelling makes it
// established dead rather than inferred dead.
//
// If cancelling fails because the intent has meanwhile succeeded, Stripe hands
// back the intent in the error and this returns that success, so the caller
// adopts it instead of discarding it.
export async function cancelPaymentIntent(paymentIntentId: string): Promise<ChargeOutcome | null> {
  if (!stripe) return null;
  try {
    return outcomeFromIntent(await stripe.paymentIntents.cancel(paymentIntentId));
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.payment_intent) {
      return outcomeFromIntent(err.payment_intent);
    }
    // Could not establish anything. The caller keeps its original resolution;
    // null says "no better information", not "cancelled".
    console.error(`[payments] could not cancel payment intent ${paymentIntentId}:`, err);
    return null;
  }
}

// Detaching removes the saved card from the customer. Callers must first check
// that no other chargeable order still depends on it.
export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  if (!stripe) return;
  await stripe.paymentMethods.detach(paymentMethodId);
}

// The client tells us which PaymentMethod the SetupIntent produced. Verify it
// really belongs to this customer before an order is written against it —
// otherwise a crafted request could attach someone else's saved card to its
// own order. With no Stripe key there is nothing to check.
export async function assertPaymentMethodBelongsTo(
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  if (!stripe) return;

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (owner !== customerId) {
    throw new Error("That payment method isn't yours.");
  }
}
