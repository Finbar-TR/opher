import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { reconcileSetupIntent } from "@/lib/joins";
import { resolveChargeOutcome } from "@/lib/cycle-run";
import { outcomeFromIntent } from "@/lib/payments";

// Stripe posts events here. Verifies the signature, then dispatches by event
// type. setup_intent.succeeded reconciles a saved card against an order the
// join request already created — it never creates an order itself.
//
// The payment_intent events are the second channel onto the same truth the
// cron's reconciler reads. Stripe usually delivers within seconds, so in
// practice this settles an interrupted charge long before the reconciler's
// next daily pass; the reconciler is the backstop for when a webhook is missed
// or misconfigured. Neither is trusted alone, and both resolve through the
// same helper so they cannot disagree.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "setup_intent.succeeded": {
      const si = event.data.object as Stripe.SetupIntent;
      const paymentMethodId =
        typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
      if (paymentMethodId) await reconcileSetupIntent(si.id, paymentMethodId);
      break;
    }
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await applyPaymentIntent(pi);
      break;
    }
    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

// Settle the PaymentAttempt this intent belongs to, using the same resolution
// mapping the cron uses. Idempotent: `resolveChargeOutcome` only acts on an
// attempt still `pending`, so a redelivered event, or one that races the
// reconciler, changes nothing and cannot double-increment a retry count.
//
// Anything unrecognisable — an intent we did not create, metadata from another
// integration, an attempt row since deleted — is logged and swallowed. It must
// return 200: a 500 tells Stripe to redeliver an event that will never make
// sense, for days. A genuine database fault is left to throw, because there a
// redelivery is exactly what we want.
async function applyPaymentIntent(pi: Stripe.PaymentIntent): Promise<void> {
  const orderId = pi.metadata?.orderId;
  const rawAttempt = pi.metadata?.attemptNumber;
  const attemptNumber = Number(rawAttempt);
  // `rawAttempt` is checked for emptiness separately: Number("") is 0, which
  // would otherwise read a blank as attempt zero.
  if (!orderId || !rawAttempt || !Number.isInteger(attemptNumber) || attemptNumber < 0) {
    console.warn(`[stripe] payment_intent ${pi.id} has no order metadata — ignored`);
    return;
  }

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { orderId_attemptNumber: { orderId, attemptNumber } },
  });
  if (!attempt) {
    console.warn(
      `[stripe] payment_intent ${pi.id} names order ${orderId} attempt ${attemptNumber}, which has no attempt row — ignored`
    );
    return;
  }

  await resolveChargeOutcome({
    attemptId: attempt.id,
    orderId,
    outcome: outcomeFromIntent(pi),
    now: new Date(),
  });
}
