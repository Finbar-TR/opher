import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { markPaymentPaid } from "@/lib/orders";

// Stripe posts payment confirmations here. Verifies the signature, then marks the
// corresponding share paid (which settles the order once all shares are in).
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      metadata?: { paymentId?: string };
      payment_intent?: string | { id: string } | null;
    };
    const paymentId = session.metadata?.paymentId;
    const pi =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (paymentId) await markPaymentPaid(paymentId, pi);
  }

  return NextResponse.json({ received: true });
}
