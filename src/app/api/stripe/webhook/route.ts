import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { reconcileSetupIntent } from "@/lib/joins";

// Stripe posts events here. Verifies the signature, then dispatches by event
// type. setup_intent.succeeded reconciles a saved card against an order the
// join request already created — it never creates an order itself.
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
    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
