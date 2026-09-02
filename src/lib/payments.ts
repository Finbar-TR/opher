import "server-only";
import { randomBytes } from "crypto";
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

// Charge a saved card with nobody present. Failures are returned, not thrown —
// the cron records them as payment_failed and retries.
//
// `idempotencyKey` should be stable per order per attempt (e.g.
// `order-<id>-attempt-<retryCount>`), so a retry of the *same* attempt — a
// crash-and-recover, or a network timeout whose request may have already
// landed at Stripe — collapses into the original PaymentIntent instead of
// creating a second one, while a genuine next attempt gets a fresh key.
export async function chargeOrder(params: {
  amountPence: number;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey?: string;
}): Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }> {
  if (!stripe) return { ok: true, paymentIntentId: devId("dev_pi") };

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: params.amountPence,
        currency: "gbp",
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        confirm: true,
        off_session: true,
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
    );
    return { ok: true, paymentIntentId: pi.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Charge failed" };
  }
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
