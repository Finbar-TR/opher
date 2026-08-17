import "server-only";
import { prisma } from "./prisma";
import { stripe } from "./stripe";
import { sendOrderCancelledEmails } from "./notifications";

// Mark a single participant's payment as paid, then settle the order if that
// was the last outstanding share. Idempotent — safe to call twice (e.g. from a
// Stripe webhook retry). Optionally records the Stripe PaymentIntent for refunds.
export async function markPaymentPaid(
  paymentId: string,
  paymentIntentId?: string
): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "paid") return;

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "paid",
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    },
  });
  await settleOrderIfPaid(payment.orderId);
}

// Refund a paid share. Issues a Stripe refund when the charge went through Stripe;
// dev-fallback payments are simply marked refunded. Idempotent.
export async function refundPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "paid") return;

  if (stripe && payment.stripePaymentIntentId) {
    try {
      await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
      });
    } catch {
      // Leave as-is if the refund fails; operator can retry / handle manually.
      return;
    }
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "refunded" },
  });
}

// Cancel an order: refund every paid share, mark it cancelled, release its
// baskets, and notify participants. Shared by the operator action and the
// auto-expiry job. Returns true if it cancelled the order.
export async function cancelOrder(
  orderId: string,
  reason: string
): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order || order.status === "cancelled" || order.status === "delivered") {
    return false;
  }

  for (const p of order.payments) {
    if (p.status === "paid") await refundPayment(p.id);
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "cancelled" },
  });
  await prisma.deliveryEvent.create({
    data: { orderId, status: "cancelled", note: reason || "Order cancelled." },
  });
  await prisma.basket.updateMany({
    where: { orderId },
    data: { status: "cancelled" },
  });

  await sendOrderCancelledEmails(orderId);
  return true;
}

// When every share on an order is paid, advance it to "paid" and log an event.
export async function settleOrderIfPaid(orderId: string): Promise<void> {
  const [order, payments] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.payment.findMany({ where: { orderId } }),
  ]);
  if (!order || order.status !== "pending_payment") return;
  if (payments.length === 0 || !payments.every((p) => p.status === "paid")) return;

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "paid" },
  });
  await prisma.deliveryEvent.create({
    data: { orderId, status: "paid", note: "All shares paid." },
  });
}
