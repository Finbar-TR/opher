import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  MAX_PAYMENT_RETRIES,
  PAYMENT_LOOKBACK_HOURS,
  PAYMENT_RECONCILE_AFTER_MINUTES,
} from "./constants";
import { ensureOpenWindows } from "./windows";
import {
  chargeOrder,
  findIntentsForAttempt,
  outcomeFromIntent,
  refundPaymentIntent,
  type ChargeOutcome,
} from "./payments";

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
//
// The governing principle for everything payment-related below: **Stripe is
// the ledger and this database is a cache of it. Never infer a payment
// outcome — establish it.** Every double-charge defect in the previous version
// came from inferring that an interrupted charge had failed.

export type CycleRunResult = {
  windowsCreated: number;
  windowsLocked: number;
  charged: number;
  chargeFailures: number;
  released: number;
  errors: number;
  // Interrupted charge attempts settled against Stripe rather than guessed at.
  reconciled: number;
  // Successful charges found to be duplicates and refunded automatically.
  duplicatesRefunded: number;
};

// What trying to charge one order came to.
//
// "claimedElsewhere" — a concurrent run's conditional claim beat this one to
// the row — is not this run's failure and is not counted at all.
// "undetermined" is the outcome that matters: the charge may or may not have
// happened, so it is neither a success nor a failure, nothing customer-visible
// moves, and the reconciler settles it against Stripe on a later run.
type AttemptResult = "charged" | "failed" | "undetermined" | "claimedElsewhere";

function recordOutcome(result: CycleRunResult, outcome: AttemptResult): void {
  if (outcome === "charged") result.charged++;
  else if (outcome === "failed") result.chargeFailures++;
}

export async function runCycles(now: Date = new Date()): Promise<CycleRunResult> {
  const result: CycleRunResult = {
    windowsCreated: 0, windowsLocked: 0, charged: 0, chargeFailures: 0,
    released: 0, errors: 0, reconciled: 0, duplicatesRefunded: 0,
  };

  // 0. Reconcile interrupted charge attempts against Stripe, BEFORE anything
  // else. An order left in `payment_pending` by a crashed run is not
  // chargeable again until we know what Stripe did with the first attempt, so
  // establishing that has to precede any phase that might charge.
  await reconcileInterruptedAttempts(now, result);

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

  // 3. Retry genuinely failed charges.
  //
  // Note what is NOT here any more: a sweep over orders stuck in
  // `payment_pending`. Order columns alone cannot distinguish "the charge
  // failed" from "we called Stripe and never learned the answer", and the old
  // code's assumption that the two were the same is what could charge a
  // customer twice. That state now lives in `PaymentAttempt` and is settled by
  // phase 0 against Stripe itself. An order still in `payment_pending` here is
  // one phase 0 could not resolve, and it is left alone by design.
  //
  // Release is evaluated for every `payment_failed` order regardless of its
  // window's delivery date — an order that has exhausted its retries must
  // always be releasable, or it sits uncharged AND uncancellable forever
  // (joins.ts refuses to cancel once `paymentAttemptedAt` is set). Only the
  // decision to attempt *another* charge is bounded: not this same run
  // (paymentAttemptedAt < now excludes anything phase 0 or phase 2 just
  // touched — retrying seconds later with no daily gap is a resend, not a
  // retry) and not a window whose delivery has already passed, which is an
  // admin matter now.
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

// ---------------------------------------------------------------------------
// Resolution: the single mapping from "what Stripe says" to "what our rows say"
// ---------------------------------------------------------------------------

// Stripe holds no PaymentIntent at all for an attempt. Not a charge outcome —
// no charge was made — but it resolves an attempt, so it travels with them.
export type Abandonment = { kind: "abandoned"; message: string };

export type AttemptResolution =
  | "resolved" // this caller applied the resolution
  | "already_resolved" // someone else (webhook, another runner) got there first
  | "left_pending"; // nothing is established yet; the reconciler will settle it

type ResolutionPlan = {
  attempt: Prisma.PaymentAttemptUpdateManyMutationInput;
  order: Prisma.OrderUpdateManyMutationInput;
};

// The mapping table, written once. Three callers depend on it — the charge
// path, the reconciler and the webhook — and divergence between them is
// precisely how a customer ends up in an inconsistent state.
//
// The two rules worth stating out loud:
//   * Only an ESTABLISHED failure increments `paymentRetryCount`. That count is
//     the customer's budget of three tries; a charge we merely lost track of
//     must never burn one of them.
//   * `abandoned` therefore leaves the retry count alone. Stripe told us
//     positively that nothing exists, so nothing was spent — not a try, and
//     not the customer's money.
function planFor(
  outcome: Exclude<ChargeOutcome, { kind: "processing" } | { kind: "unknown" }> | Abandonment,
  now: Date
): ResolutionPlan {
  switch (outcome.kind) {
    case "succeeded":
      return {
        attempt: {
          status: "succeeded",
          stripePaymentIntentId: outcome.paymentIntentId,
          resolvedAt: now,
        },
        order: {
          status: "paid",
          stripePaymentIntentId: outcome.paymentIntentId,
          paymentAttemptedAt: now,
        },
      };
    case "failed":
      return {
        attempt: {
          status: "failed",
          stripePaymentIntentId: outcome.paymentIntentId ?? null,
          errorCode: outcome.code ?? null,
          errorMessage: outcome.message,
          resolvedAt: now,
        },
        order: {
          status: "payment_failed",
          paymentAttemptedAt: now,
          paymentRetryCount: { increment: 1 },
        },
      };
    case "requires_action":
      // The card needs the customer present. Off-session there is nothing more
      // this run can do, so it counts as a failed try like any other decline —
      // but the reason is kept, because it is the one failure a customer can
      // actually fix themselves.
      return {
        attempt: {
          status: "requires_action",
          stripePaymentIntentId: outcome.paymentIntentId,
          errorCode: outcome.code ?? "authentication_required",
          errorMessage: outcome.message ?? "The card needs the customer present to authenticate.",
          resolvedAt: now,
        },
        order: {
          status: "payment_failed",
          paymentAttemptedAt: now,
          paymentRetryCount: { increment: 1 },
        },
      };
    case "abandoned":
      return {
        attempt: { status: "abandoned", errorMessage: outcome.message, resolvedAt: now },
        // Retry count deliberately UNCHANGED — see the note above. The order
        // returns to `payment_failed` so the normal retry path picks it up on
        // the next run, with a fresh attempt number and a fresh idempotency key.
        order: { status: "payment_failed", paymentAttemptedAt: now },
      };
  }
}

// Apply a resolution to one attempt and its order together, or not at all.
//
// Idempotent by construction: the attempt is claimed with `status: "pending"`
// as a guard, so whichever of the reconciler and the webhook arrives second
// finds nothing to do and cannot re-apply a retry increment.
export async function resolveChargeOutcome(params: {
  attemptId: string;
  orderId: string;
  outcome: ChargeOutcome | Abandonment;
  now: Date;
}): Promise<AttemptResolution> {
  const { attemptId, orderId, outcome, now } = params;

  // `processing` (Stripe has the money in flight) and `unknown` (our call
  // threw and told us nothing) are neither success nor failure. Both leave the
  // attempt `pending` and the order `payment_pending`, untouched, for the
  // reconciler — writing anything here would be inventing an answer.
  if (outcome.kind === "processing" || outcome.kind === "unknown") return "left_pending";

  const plan = planFor(outcome, now);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentAttempt.updateMany({
      where: { id: attemptId, status: "pending" },
      data: plan.attempt,
    });
    if (claimed.count === 0) return "already_resolved";

    // The order only ever moves out of `payment_pending`. Finding it anywhere
    // else means something outside this flow (an admin cancellation, a manual
    // refund) has taken it somewhere terminal, and silently overwriting that
    // would be worse than the two rows disagreeing loudly. The attempt row
    // still records what Stripe said, so a human has the payment reference.
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: "payment_pending" },
      data: plan.order,
    });
    if (moved.count === 0) {
      const intentId =
        "paymentIntentId" in outcome ? outcome.paymentIntentId : undefined;
      console.error(
        `[payments] order ${orderId} was not in payment_pending when attempt ${attemptId} resolved as ${outcome.kind}` +
          (intentId ? ` (payment intent ${intentId})` : "") +
          " — needs manual reconciliation"
      );
    }
    return "resolved";
  });
}

// ---------------------------------------------------------------------------
// Phase 0: the reconciler
// ---------------------------------------------------------------------------

// Settle every charge attempt a crashed or timed-out run left `pending`, by
// asking Stripe what actually happened. This function never charges anything:
// it adopts what Stripe already holds, and the only branch that lets an order
// be charged again is the one where Stripe positively holds nothing.
async function reconcileInterruptedAttempts(
  now: Date,
  result: CycleRunResult
): Promise<void> {
  const staleBefore = new Date(now.getTime() - PAYMENT_RECONCILE_AFTER_MINUTES * 60 * 1000);
  const stale = await prisma.paymentAttempt.findMany({
    where: { status: "pending", createdAt: { lt: staleBefore } },
    include: { order: true },
  });

  // Each attempt is isolated: one customer whose lookup fails must not stop
  // the rest of the sweep.
  for (const attempt of stale) {
    try {
      const customerId = attempt.order.stripeCustomerId;
      if (!customerId) {
        console.error(
          `[payments] attempt ${attempt.id} on order ${attempt.orderId} has no Stripe customer to reconcile against — left pending for manual review`
        );
        continue;
      }

      // The lookback is a floor, not a ceiling. Always widen the search to
      // cover the attempt's own creation time: if the cron were down for three
      // days, a fixed 48-hour window would put the real PaymentIntent out of
      // range, "nothing found" would read as "no charge exists", and we would
      // charge the card a second time — the exact bug this task removes.
      const lookbackFrom = new Date(now.getTime() - PAYMENT_LOOKBACK_HOURS * 60 * 60 * 1000);
      const attemptFrom = new Date(attempt.createdAt.getTime() - 5 * 60 * 1000);
      const since = attemptFrom < lookbackFrom ? attemptFrom : lookbackFrom;

      const intents = await findIntentsForAttempt({
        customerId,
        orderId: attempt.orderId,
        attemptNumber: attempt.attemptNumber,
        since,
      });

      if (intents.length === 0) {
        // Stripe holds nothing under this attempt's metadata, so the request
        // never landed and no money moved. This is the only branch that frees
        // the order to be charged again, and it is reached only from a
        // positive statement by Stripe — never from a timeout, and never from
        // a page of results we stopped reading (findIntentsForAttempt throws
        // rather than return a truncated list).
        const applied = await resolveChargeOutcome({
          attemptId: attempt.id,
          orderId: attempt.orderId,
          outcome: {
            kind: "abandoned",
            message: "No PaymentIntent found at Stripe for this attempt",
          },
          now,
        });
        if (applied === "resolved") result.reconciled++;
        continue;
      }

      // More than one intent for a single attempt means a duplicate charge
      // exists. Refund the extras BEFORE resolving the order, so the order is
      // not recorded as paid while a second successful charge still stands.
      const succeeded = intents.filter((pi) => pi.status === "succeeded");
      const keep = succeeded[0] ?? intents[0];

      for (const pi of intents) {
        if (pi.id === keep.id) continue;

        if (pi.status !== "succeeded") {
          // Not refundable yet, and not necessarily dead either: a `processing`
          // duplicate can still land. Resolving the attempt below closes this
          // sweep's last look at it, so a human has to.
          if (pi.status !== "canceled") {
            console.error(
              `[payments] payment intent ${pi.id} on order ${attempt.orderId} attempt ${attempt.attemptNumber} is ${pi.status} alongside kept ${keep.id} — may yet become a second charge, needs manual attention`
            );
          }
          continue;
        }

        try {
          await refundPaymentIntent(pi.id);
          result.duplicatesRefunded++;
          console.error(
            `[payments] duplicate charge refunded: payment intent ${pi.id} on order ${attempt.orderId} attempt ${attempt.attemptNumber} (kept ${keep.id})`
          );
        } catch (err) {
          // A refund that cannot be made is not a reason to abandon the whole
          // resolution: leaving the attempt pending would park the order in
          // `payment_pending` indefinitely and, when the refund failed because
          // it had already been made, retry it forever. Resolve the order and
          // hand the duplicate to a human.
          result.errors++;
          console.error(
            `[payments] could not refund duplicate charge ${pi.id} on order ${attempt.orderId} — REFUND MANUALLY:`,
            err
          );
        }
      }

      const applied = await resolveChargeOutcome({
        attemptId: attempt.id,
        orderId: attempt.orderId,
        outcome: outcomeFromIntent(keep),
        now,
      });
      if (applied === "resolved") result.reconciled++;
    } catch (err) {
      result.errors++;
      console.error(`[cycle-run] reconciling payment attempt ${attempt.id} threw:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// The write-ahead charge protocol
// ---------------------------------------------------------------------------

// Charge one order. The ORDER of operations is the whole point:
//
//   1. Claim the order (conditional update) so no concurrent run can charge it.
//   2. Write a `pending` PaymentAttempt row BEFORE the network call, so a
//      process that dies mid-charge always leaves evidence that a charge may
//      have been made. Without that row a crash is indistinguishable from a
//      charge that never happened, and re-charging on that assumption is what
//      took money twice.
//   3. Call Stripe.
//   4. Resolve the attempt and the order together, in one transaction.
//
// The claim stamps `paymentAttemptedAt` in the same conditional update: setting
// only `status` would let an overlapping run reclaim a charge still
// legitimately in flight.
async function attemptCharge(orderId: string, now: Date): Promise<AttemptResult> {
  // Read first, so a claim that has to be released can be put back exactly as
  // it was rather than guessed at.
  const before = await prisma.order.findUnique({ where: { id: orderId } });
  if (!before) return "claimedElsewhere";

  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["committed", "payment_failed"] } },
    data: { status: "payment_pending", paymentAttemptedAt: now },
  });
  if (claimed.count === 0) return "claimedElsewhere";

  // No saved card. This is established without calling Stripe at all, so there
  // is nothing to reconcile later and no attempt row to write.
  if (!before.stripeCustomerId || !before.stripePaymentMethodId) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "payment_failed",
        paymentAttemptedAt: now,
        paymentRetryCount: { increment: 1 },
      },
    });
    return "failed";
  }

  // `attemptNumber` counts attempts on this order. It is deliberately NOT
  // `paymentRetryCount`: an undetermined or abandoned attempt leaves the retry
  // count alone, so reusing it would hand the next attempt the same
  // idempotency key it already used — and, via the unique constraint below,
  // deadlock the order permanently. Attempts counted separately always yield a
  // fresh key while the retry budget stays the customer's.
  const attemptNumber = await prisma.paymentAttempt.count({ where: { orderId } });
  const idempotencyKey = `order-${orderId}-attempt-${attemptNumber}`;

  let attempt;
  try {
    attempt = await prisma.paymentAttempt.create({
      data: { orderId, attemptNumber, idempotencyKey, status: "pending" },
    });
  } catch (err) {
    // The unique key on (orderId, attemptNumber) is where two runners racing
    // the same attempt collide. The loser stops — and puts the order back, or
    // it would sit in `payment_pending` with no attempt row, invisible to the
    // reconciler, which only ever looks at attempts.
    await prisma.order.updateMany({
      where: { id: orderId, status: "payment_pending" },
      data: {
        status: before.status === "payment_failed" ? "payment_failed" : "committed",
        paymentAttemptedAt: before.paymentAttemptedAt,
      },
    });
    console.error(`[payments] could not open attempt ${attemptNumber} for order ${orderId}:`, err);
    return "claimedElsewhere";
  }

  const outcome = await chargeOrder({
    orderId,
    attemptNumber,
    amountPence: before.totalPence,
    customerId: before.stripeCustomerId,
    paymentMethodId: before.stripePaymentMethodId,
    idempotencyKey,
  });

  const applied = await resolveChargeOutcome({
    attemptId: attempt.id,
    orderId,
    outcome,
    now,
  });

  if (applied === "left_pending") {
    // Nothing established, nothing written. The order stays `payment_pending`
    // with a `pending` attempt, and phase 0 of a later run asks Stripe what
    // happened. Loud, because a run that ends with these outstanding is a run
    // that did not finish its job.
    console.error(
      `[payments] order ${orderId} attempt ${attemptNumber} is undetermined (${outcome.kind}) — left for reconciliation, retry count untouched`
    );
    return "undetermined";
  }

  return outcome.kind === "succeeded" ? "charged" : "failed";
}
