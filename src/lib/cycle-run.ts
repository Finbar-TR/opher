import "server-only";
import { prisma } from "./prisma";
import { MAX_PAYMENT_RETRIES } from "./constants";
import { ensureOpenWindows } from "./windows";
import { demandedGrams } from "./demand";
import { decideCycle } from "./cutoff";
import { chargeOrder } from "./payments";

// The daily 08:00 UTC run. 08:00 is not arbitrary: it is the hour every window's
// cutoff falls at, so the cutoff and the charge are the same moment.
//
// Order matters. Each window is locked, then decided on committed demand, and
// only a confirmed cycle charges anybody — so a basket that fails costs its
// joiners nothing. Every step is idempotent: reruns act only on rows still in
// the status they expect.

export type CycleRunResult = {
  windowsCreated: number;
  windowsLocked: number;
  confirmed: number;
  failed: number;
  charged: number;
  chargeFailures: number;
  released: number;
};

export async function runCycles(now: Date = new Date()): Promise<CycleRunResult> {
  const result: CycleRunResult = {
    windowsCreated: 0, windowsLocked: 0, confirmed: 0, failed: 0,
    charged: 0, chargeFailures: 0, released: 0,
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

  // 2. Cutoff: every open window whose moment has come.
  const due = await prisma.deliveryWindow.findMany({
    where: { status: "open", cutoffAt: { lte: now } },
    include: { city: true },
  });

  for (const window of due) {
    await prisma.deliveryWindow.update({
      where: { id: window.id },
      data: { status: "locked" },
    });
    result.windowsLocked++;

    // Every basket in this city that anyone actually joined this cycle.
    const baskets = await prisma.basket.findMany({
      where: { cityId: window.cityId, orders: { some: { deliveryWindowId: window.id } } },
      include: { sku: true },
    });

    for (const basket of baskets) {
      const demanded = await demandedGrams(basket.id, window.id);
      const decision = decideCycle(
        demanded,
        {
          stockAt3pl: basket.sku.stockAt3pl,
          leadTimeDays: basket.sku.leadTimeDays,
          purchaseThresholdGrams: basket.sku.purchaseThresholdGrams,
        },
        window.city.cutoffDays
      );

      await prisma.demandSnapshot.upsert({
        where: { basketId_windowId: { basketId: basket.id, windowId: window.id } },
        create: {
          basketId: basket.id, windowId: window.id,
          outcome: decision.outcome, decidedAt: now, demandedGramsAtDecision: demanded,
        },
        update: {
          outcome: decision.outcome, decidedAt: now, demandedGramsAtDecision: demanded,
        },
      });

      if (decision.outcome === "failed") {
        // Nobody is charged. Release every committed order untouched by Stripe.
        const released = await prisma.order.updateMany({
          where: { basketId: basket.id, deliveryWindowId: window.id, status: "committed" },
          data: { status: "cancelled" },
        });
        result.failed++;
        result.released += released.count;
        continue;
      }

      result.confirmed++;

      // Charge only now that the cycle is going ahead.
      const orders = await prisma.order.findMany({
        where: { basketId: basket.id, deliveryWindowId: window.id, status: "committed" },
      });
      for (const order of orders) {
        const charge = await attemptCharge(order.id, now);
        if (charge) result.charged++;
        else result.chargeFailures++;
      }

      if (decision.purchaseGrams > 0) {
        // Cost is per bulk unit, so round up to whole units of the SKU.
        const units = Math.ceil(decision.purchaseGrams / basket.sku.weightGrams);
        await prisma.purchaseOrder.create({
          data: {
            skuId: basket.sku.id,
            windowId: window.id,
            quantityGrams: decision.purchaseGrams,
            totalCostPence: units * basket.sku.wholesaleCostPence,
          },
        });
      }
    }
  }

  // 3. Retry failed charges, and release orders that have exhausted them.
  const failed = await prisma.order.findMany({
    where: { status: "payment_failed" },
  });
  for (const order of failed) {
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
