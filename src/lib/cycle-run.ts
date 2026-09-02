import "server-only";
import { prisma } from "./prisma";
import { MAX_PAYMENT_RETRIES, PAYMENT_PENDING_RECOVERY_MINUTES } from "./constants";
import { ensureOpenWindows } from "./windows";
import { chargeOrder } from "./payments";

// The daily 08:00 UTC run. 08:00 is not arbitrary: it is the hour every window's
// cutoff falls at, so the cutoff and the charge are the same moment.
//
// There is no minimum-demand decision any more: every committed order is
// charged at its window's cutoff. So the work per window is just "lock it,
// then charge what's in it" — re-entrant because a rerun (the daily cron, or
// the next run after a crash) only ever selects orders still `committed`, and
// `attemptCharge`'s conditional claim stops two runs charging the same order
// even if they overlap.

export type CycleRunResult = {
  windowsCreated: number;
  windowsLocked: number;
  charged: number;
  chargeFailures: number;
  released: number;
};

export async function runCycles(now: Date = new Date()): Promise<CycleRunResult> {
  const result: CycleRunResult = {
    windowsCreated: 0, windowsLocked: 0, charged: 0, chargeFailures: 0, released: 0,
  };

  // 1. Advance: close out delivered windows, then top up the open ones.
  //
  // `open` is included deliberately. If the cron missed a day, a window could
  // sit open past its own delivery date — and charging cards for a delivery
  // that has already been and gone would be worse than leaving its orders
  // uncharged for an admin to look at. A past delivery date ends the cycle
  // whatever state it was in, and step 2 then skips it.
  await prisma.deliveryWindow.updateMany({
    where: { status: { in: ["open", "locked"] }, deliveryDate: { lte: now } },
    data: { status: "dispatched" },
  });
  result.windowsCreated = (await ensureOpenWindows(now)).created;

  // 2. Cutoff: every window whose moment has come, whether it is still `open`
  // (its normal state at this point) or already `locked` (a previous run
  // reached it but did not finish charging every order — a crash, a timeout).
  // Re-selecting `locked` windows, combined with only ever selecting orders
  // still `committed`, is what makes this phase re-entrant: an order already
  // moved on to payment_pending/paid/payment_failed is simply not picked up
  // again here.
  const due = await prisma.deliveryWindow.findMany({
    where: { status: { in: ["open", "locked"] }, cutoffAt: { lte: now } },
  });

  for (const window of due) {
    if (window.status !== "locked") {
      await prisma.deliveryWindow.update({
        where: { id: window.id },
        data: { status: "locked" },
      });
      result.windowsLocked++;
    }

    const orders = await prisma.order.findMany({
      where: { deliveryWindowId: window.id, status: "committed" },
    });
    for (const order of orders) {
      const charge = await attemptCharge(order.id, now);
      if (charge) result.charged++;
      else result.chargeFailures++;
    }
  }

  // 3. Reconcile, then retry.
  //
  // First, orders a crashed run left stuck in `payment_pending` — claimed for
  // charging but never resolved either way. A stale `paymentAttemptedAt`
  // (older than the recovery window, or never set) marks a charge that is no
  // longer plausibly in flight. Recharging reuses the same idempotency key
  // (order id + retry count, unchanged since the interrupted attempt), so if
  // Stripe already completed that PaymentIntent this collapses onto it
  // instead of creating a second charge.
  const staleBefore = new Date(now.getTime() - PAYMENT_PENDING_RECOVERY_MINUTES * 60 * 1000);
  const stuckPending = await prisma.order.findMany({
    where: {
      status: "payment_pending",
      OR: [{ paymentAttemptedAt: null }, { paymentAttemptedAt: { lt: staleBefore } }],
      window: { deliveryDate: { gt: now } },
    },
  });
  for (const order of stuckPending) {
    const charge = await reclaimStuckPending(order.id, now, staleBefore);
    if (charge) result.charged++;
    else result.chargeFailures++;
  }

  // Then genuinely failed charges — excluding anything this very run just
  // attempted (that's phase 2's charge loop or the recovery above; retrying
  // it again seconds later, with no daily gap and against the same
  // idempotency key attempt number, is not a retry, it's a resend) and
  // anything whose window has already been delivered, which is an admin
  // matter now, not something to keep charging cards for.
  const failedOrders = await prisma.order.findMany({
    where: {
      status: "payment_failed",
      paymentAttemptedAt: { lt: now },
      window: { deliveryDate: { gt: now } },
    },
  });
  for (const order of failedOrders) {
    if (order.paymentRetryCount >= MAX_PAYMENT_RETRIES) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
      result.released++;
      continue;
    }
    const charge = await attemptCharge(order.id, now);
    if (charge) result.charged++;
    else result.chargeFailures++;
  }

  return result;
}

// Charge one order, moving it through payment_pending so a concurrent run
// cannot pick it up twice. Returns whether the charge succeeded.
async function attemptCharge(orderId: string, now: Date): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["committed", "payment_failed"] } },
    data: { status: "payment_pending" },
  });
  if (claimed.count === 0) return false; // another run already has it

  return performCharge(orderId, now);
}

// Reclaim an order a crashed run left stuck in `payment_pending`. The claim
// here cannot use a status transition — the order is already payment_pending
// — so it conditions on `paymentAttemptedAt` still being stale instead:
// whichever concurrent caller wins the update to `now` gets to charge, the
// other sees zero rows matched and backs off.
async function reclaimStuckPending(orderId: string, now: Date, staleBefore: Date): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "payment_pending",
      OR: [{ paymentAttemptedAt: null }, { paymentAttemptedAt: { lt: staleBefore } }],
    },
    data: { paymentAttemptedAt: now },
  });
  if (claimed.count === 0) return false;

  return performCharge(orderId, now);
}

// The actual Stripe round-trip and its outcome bookkeeping, shared by a fresh
// charge, a same-day retry, and a recovered payment_pending order. The
// idempotency key is stable for a given order's given attempt number, so
// calling this twice for the same unresolved attempt (the exact situation
// recovery exists for) cannot double-charge.
async function performCharge(orderId: string, now: Date): Promise<boolean> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (!order.stripeCustomerId || !order.stripePaymentMethodId) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "payment_failed",
        paymentAttemptedAt: now,
        paymentRetryCount: { increment: 1 },
      },
    });
    return false;
  }

  const charge = await chargeOrder({
    amountPence: order.totalPence,
    customerId: order.stripeCustomerId,
    paymentMethodId: order.stripePaymentMethodId,
    idempotencyKey: `order-${order.id}-attempt-${order.paymentRetryCount}`,
  });

  if (charge.ok) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "paid",
        stripePaymentIntentId: charge.paymentIntentId,
        paymentAttemptedAt: now,
      },
    });
    return true;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "payment_failed",
      paymentAttemptedAt: now,
      paymentRetryCount: { increment: 1 },
    },
  });
  return false;
}
