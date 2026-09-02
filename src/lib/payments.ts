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
    // A Stripe API error carries the PaymentIntent it acted on — a decline, an
    // off-session authentication requirement. That IS Stripe's answer, so it
    // goes through the same mapping as a returned intent rather than being
    // hand-assembled into a "failed". A network error carries no intent: it is
    // genuinely undetermined and must NOT be treated as a failure.
    if (err instanceof Stripe.errors.StripeError && err.payment_intent) {
      return outcomeFromIntent(err.payment_intent);
    }
    return {
      kind: "unknown",
      message: err instanceof Error ? err.message : "Charge outcome unknown",
    };
  }
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
export async function findIntentsForAttempt(params: {
  customerId: string;
  orderId: string;
  attemptNumber: number;
  since: Date;
}): Promise<Stripe.PaymentIntent[]> {
  if (!stripe) return [];

  const created = { gte: Math.floor(params.since.getTime() / 1000) };
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

export async function refundPaymentIntent(paymentIntentId: string): Promise<void> {
  if (!stripe) return;
  await stripe.refunds.create({ payment_intent: paymentIntentId });
}

// Detaching removes the saved card from the customer. Callers must first check
// that no other chargeable order still depends on it.
export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  if (!stripe) return;
  await stripe.paymentMethods.detach(paymentMethodId);
}
