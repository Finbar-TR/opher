"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { markPaymentPaid } from "@/lib/orders";
import { requestBaseUrl } from "@/lib/base-url";

// Pay the current user's share of an order.
// - With Stripe configured: creates a hosted Checkout session and redirects to it.
// - Without Stripe (local dev): marks the share paid directly so the flow is testable.
export async function payShareAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const paymentId = String(formData.get("paymentId"));

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { include: { commodity: true } } },
  });
  if (!payment || payment.userId !== user.id) return;
  if (payment.status === "paid") redirect(`/orders/${payment.orderId}`);
  if (payment.order.status !== "pending_payment") {
    redirect(`/orders/${payment.orderId}`);
  }

  const baseUrl = await requestBaseUrl();

  if (!stripeConfigured() || !stripe) {
    // Dev fallback: settle immediately.
    await markPaymentPaid(paymentId);
    revalidatePath(`/orders/${payment.orderId}`);
    redirect(`/orders/${payment.orderId}?paid=1`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `${payment.order.commodity.name} — ${payment.portions} portion(s)`,
          },
          unit_amount: payment.amount,
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/orders/${payment.orderId}?paid=1`,
    cancel_url: `${baseUrl}/orders/${payment.orderId}`,
    client_reference_id: paymentId,
    metadata: { paymentId },
    customer_email: user.email,
  });

  await prisma.payment.update({
    where: { id: paymentId },
    data: { stripeSessionId: session.id },
  });

  redirect(session.url!);
}
