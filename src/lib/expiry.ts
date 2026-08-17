import "server-only";
import { prisma } from "./prisma";
import { cancelOrder } from "./orders";
import { sendBasketExpiredEmails } from "./notifications";

export type ExpiryResult = { basketsCancelled: number; ordersCancelled: number };

// Sweep for expired baskets and orders. Triggered by a scheduled request to
// /api/cron/expire (e.g. Google Cloud Scheduler). Safe to run repeatedly.
export async function runExpiry(): Promise<ExpiryResult> {
  const now = new Date();
  let basketsCancelled = 0;
  let ordersCancelled = 0;

  // Open/committed baskets past their deadline that never merged into an order.
  const staleBaskets = await prisma.basket.findMany({
    where: {
      status: { in: ["open", "committed"] },
      orderId: null,
      expiresAt: { not: null, lt: now },
    },
  });
  for (const b of staleBaskets) {
    await prisma.basket.update({
      where: { id: b.id },
      data: { status: "cancelled" },
    });
    await sendBasketExpiredEmails(b.id);
    basketsCancelled++;
  }

  // Orders awaiting payment past their due date → cancel + refund any paid shares.
  const staleOrders = await prisma.order.findMany({
    where: {
      status: "pending_payment",
      paymentDueAt: { not: null, lt: now },
    },
  });
  for (const o of staleOrders) {
    if (await cancelOrder(o.id, "Payment deadline passed — order cancelled.")) {
      ordersCancelled++;
    }
  }

  return { basketsCancelled, ordersCancelled };
}
