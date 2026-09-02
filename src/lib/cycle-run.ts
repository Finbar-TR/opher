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
// even if they overlap. A window, and each order within it, is isolated in
// its own try/catch: one thrown error must not abort every other city's run.

export type CycleRunResult = {
  windowsCreated: number;
  windowsLocked: number;
  charged: number;
  chargeFailures: number;
  released: number;
  errors: number;
  // Orders found stuck in `payment_pending` for longer than
  // PAYMENT_PENDING_RECOVERY_MINUTES. Deliberately not acted on — see the
  // comment above the recovery query below.
  strandedPending: number;
};

// What trying to charge one order came to. "claimedElsewhere" — a concurrent
// run's conditional claim beat this one to the row — is not this run's
// failure and is not counted in the result at all.
type ChargeOutcome = "charged" | "failed" | "claimedElsewhere";

function recordOutcome(result: CycleRunResult, outcome: ChargeOutcome): void {
  if (outcome === "charged") result.charged++;
  else if (outcome === "failed") result.chargeFailures++;
}

export async function runCycles(now: Date = new Date()): Promise<CycleRunResult> {
  const result: CycleRunResult = {
    windowsCreated: 0, windowsLocked: 0, charged: 0, chargeFailures: 0,
    released: 0, errors: 0, strandedPending: 0,
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
  //
  // (A future `rolled_over` window status is out of scope here: phase 2
  // already filters to `open`/`locked`, so such a window is excluded with no
  // change needed.)
  //
  // Each window, and each order within it, gets its own try/catch: one thrown
  // error (a deleted row, a DB hiccup) must not abort every other city's run.
  const due = await prisma.deliveryWindow.findMany({
    where: { status: { in: ["open", "locked"] }, cutoffAt: { lte: now } },
  });

  for (const window of due) {
    try {
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
        try {
          recordOutcome(result, await attemptCharge(order.id, now));
        } catch (err) {
          result.errors++;
          console.error(`[cycle-run] order ${order.id} in window ${window.id} threw:`, err);
        }
      }
    } catch (err) {
      result.errors++;
      console.error(`[cycle-run] window ${window.id} threw:`, err);
    }
  }

  // 3. Reconcile, then retry.
  //
  // Orders a crashed run left stuck in `payment_pending` — claimed for
  // charging but never resolved either way. Recovery here is deliberately
  // INERT: charging again on the assumption that the interrupted attempt
  // failed is exactly how a stranded charge becomes a double charge, since
  // the process could equally have died after Stripe confirmed the charge
  // but before the result was written back. Resolving that properly needs a
  // payment-attempt audit trail, webhook-driven reconciliation, and duplicate
  // detection — a dedicated task, not this fix. Until then, a stranded order
  // is left exactly as it is and surfaced loudly, which is a far cheaper
  // failure than charging a customer twice.
  const staleBefore = new Date(now.getTime() - PAYMENT_PENDING_RECOVERY_MINUTES * 60 * 1000);
  const stuckPending = await prisma.order.findMany({
    where: {
      status: "payment_pending",
      OR: [{ paymentAttemptedAt: null }, { paymentAttemptedAt: { lt: staleBefore } }],
    },
  });
  for (const order of stuckPending) {
    result.strandedPending++;
    console.warn(
      `[cycle-run] order ${order.id} stranded in payment_pending since ${order.paymentAttemptedAt?.toISOString() ?? "unknown"} — needs manual reconciliation, not auto-retried`
    );
  }

  // Then genuinely failed charges. Release is evaluated for every
  // `payment_failed` order regardless of its window's delivery date — an
  // order that has exhausted its retries must always be releasable, or it
  // sits uncharged AND uncancellable forever (joins.ts refuses to cancel once
  // `paymentAttemptedAt` is set). Only the decision to attempt *another*
  // charge is bounded: not this same run (paymentAttemptedAt < now excludes
  // anything phase 2 just touched — retrying seconds later with no daily gap
  // is a resend, not a retry) and not a window whose delivery has already
  // passed, which is an admin matter now.
  const failedOrders = await prisma.order.findMany({
    where: { status: "payment_failed", paymentAttemptedAt: { lt: now } },
    include: { window: true },
  });
  for (const order of failedOrders) {
    try {
      if (order.paymentRetryCount >= MAX_PAYMENT_RETRIES) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
        result.released++;
        continue;
      }
      if (order.window.deliveryDate <= now) continue; // delivered already — leave for an admin
      recordOutcome(result, await attemptCharge(order.id, now));
    } catch (err) {
      result.errors++;
      console.error(`[cycle-run] retry for order ${order.id} threw:`, err);
    }
  }

  return result;
}

// Charge one order, moving it through payment_pending so a concurrent run
// cannot pick it up twice. The claim stamps `paymentAttemptedAt` in the same
// conditional update: if it only set `status`, a first attempt would leave
// `paymentAttemptedAt: null`, and the recovery query above's `OR
// [paymentAttemptedAt: null, ...]` would match it regardless of age —
// bypassing the recovery grace period for the common case, and letting an
// overlapping run reclaim a charge that is still legitimately in flight.
async function attemptCharge(orderId: string, now: Date): Promise<ChargeOutcome> {
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["committed", "payment_failed"] } },
    data: { status: "payment_pending", paymentAttemptedAt: now },
  });
  if (claimed.count === 0) return "claimedElsewhere";

  return (await performCharge(orderId, now)) ? "charged" : "failed";
}

// The actual Stripe round-trip and its outcome bookkeeping, shared by a fresh
// charge and a same-day retry. The idempotency key is stable for a given
// order's given attempt number, so a retry of the same unresolved attempt
// cannot double-charge as long as the key hasn't expired.
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
