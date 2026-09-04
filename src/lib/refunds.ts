import "server-only";
import { prisma } from "./prisma";
import { refundPaymentIntent } from "./payments";

// The admin backstop for a charged order that needs its money back — supply
// bought by hand fell through, a delivery got pulled, or an operator simply
// needs to undo a charge. There is no automatic refund path: every committed
// order in a window is charged at cutoff with no feasibility check first, so
// this is the only way money ever comes back.
//
// A refunded order drops out of `DEMAND_COUNTED_STATUSES` (constants.ts), so a
// later view of the window's demand reflects what is actually still paid for.

export async function refundOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (order.status !== "paid" || !order.stripePaymentIntentId) {
    throw new Error("This order has not been charged, so there is nothing to refund.");
  }

  // `refundPaymentIntent` keys its own idempotency on the payment intent id
  // (see payments.ts), so calling it twice for the same intent — including a
  // second `refundWindow` sweep — collapses into one refund at Stripe rather
  // than erroring or double-refunding.
  await refundPaymentIntent(order.stripePaymentIntentId);

  await prisma.order.update({ where: { id: orderId }, data: { status: "refunded" } });
}

// Refund every currently-paid order in a window — the whole-window version,
// used when a delivery itself is pulled after cards were already taken.
//
// Idempotent: it only ever selects orders still `status: "paid"`, so a second
// call finds none left and refunds nothing.
export async function refundWindow(windowId: string): Promise<{ refunded: number }> {
  const orders = await prisma.order.findMany({
    where: { deliveryWindowId: windowId, status: "paid" },
    select: { id: true },
  });

  for (const order of orders) await refundOrder(order.id);
  return { refunded: orders.length };
}
