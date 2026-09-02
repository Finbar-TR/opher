import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  MAX_PAYMENT_ATTEMPTS,
  MAX_PAYMENT_RETRIES,
  PAYMENT_LOOKUP_AFTER_HOURS,
  PAYMENT_LOOKUP_BEFORE_MINUTES,
  PAYMENT_RECONCILE_AFTER_MINUTES,
} from "./constants";
import { ensureOpenWindows } from "./windows";
import {
  cancelPaymentIntent,
  chargeOrder,
  findIntentsForAttempt,
  outcomeFromIntent,
  refundPaymentIntent,
  throwIfFatalConfig,
  PaymentConfigurationError,
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
  // Attempts the reconciler could not settle, leaving an order frozen in
  // `payment_pending` until a human resolves it. Deliberately NOT auto-cancelled:
  // these are the cases where we cannot say whether money moved, and telling a
  // customer their order is cancelled while a charge may stand unrefunded
  // against their card is the worst outcome available. Counted separately from
  // `errors` because this one names orders needing human action, not just a
  // run that hit a problem.
  needsManualReview: number;
  // The run stopped early because Stripe rejected our credentials. Nothing
  // after the abort was attempted. The cron route turns this into a non-200 so
  // it pages someone rather than reading as a quiet, successful no-op.
  aborted: boolean;
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
    needsManualReview: 0, aborted: false,
  };

  try {
    await runPhases(now, result);
  } catch (err) {
    // The only error that reaches here. Every other fault is isolated to one
    // window, order or attempt; this one is a fact about the whole run, so the
    // run stops rather than iterating orders it cannot possibly charge.
    if (!(err instanceof PaymentConfigurationError)) throw err;

    result.aborted = true;
    console.error(
      "\n" +
        "================================================================\n" +
        "[payments] RUN ABORTED — STRIPE REJECTED OUR CREDENTIALS\n" +
        `  ${err.message}\n` +
        "  No order was charged, released or modified after this point.\n" +
        "  Check STRIPE_SECRET_KEY: rotated, revoked, or missing permissions.\n" +
        "  THIS NEEDS A HUMAN NOW — the daily charge run is not happening.\n" +
        "================================================================\n"
    );
  }

  return result;
}

async function runPhases(now: Date, result: CycleRunResult): Promise<void> {
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
          // Per-order isolation, EXCEPT for a run-level fault: broken
          // credentials are not this order's problem and every subsequent
          // order would fail the same way.
          throwIfFatalConfig(err);
          result.errors++;
          console.error(`[cycle-run] order ${order.id} in window ${window.id} threw:`, err);
        }
      }
    } catch (err) {
      throwIfFatalConfig(err);
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
  // Release is evaluated regardless of the window's delivery date — an order
  // that has exhausted its tries must always be releasable, or it sits
  // uncharged AND uncancellable forever (joins.ts refuses to cancel once
  // `paymentAttemptedAt` is set). Only the decision to attempt *another* charge
  // is bounded: not this same run (paymentAttemptedAt < now excludes anything
  // phase 0 or phase 2 just touched — retrying seconds later with no daily gap
  // is a resend, not a retry) and not a window whose delivery has already
  // passed, which is an admin matter now.
  //
  // `payment_pending` orders are selected too, for the release checks ONLY.
  // The exits used to live behind `status: "payment_failed"`, which meant an
  // order the reconciler could never settle sat outside both of them — the
  // same trap in a narrower doorway. An order at the cap must be released
  // whatever status it is sitting in, or the cap is not a guarantee.
  const stuckOrders = await prisma.order.findMany({
    where: {
      status: { in: ["payment_failed", "payment_pending"] },
      paymentAttemptedAt: { lt: now },
    },
    include: { window: true },
  });
  for (const order of stuckOrders) {
    try {
      // Two independent exits, and the second is the one that guarantees
      // termination. `paymentRetryCount` only counts ESTABLISHED failures, so
      // an order whose charge can never reach Stripe at all — a payment method
      // detached at Stripe, say — is abandoned by the reconciler every run,
      // spends no retry, and would be retried for ever. It cannot be cancelled
      // by the customer either: joins.ts refuses once `paymentAttemptedAt` is
      // set, and it is set by the first claim. Capping TOTAL attempts however
      // they resolved is what stops a customer being trapped with no exit.
      const attemptCount = await prisma.paymentAttempt.count({ where: { orderId: order.id } });
      const spentRetries = order.paymentRetryCount >= MAX_PAYMENT_RETRIES;
      const spentAttempts = attemptCount >= MAX_PAYMENT_ATTEMPTS;

      if (spentRetries || spentAttempts) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
        result.released++;
        if (spentAttempts && !spentRetries) {
          console.error(
            `[payments] order ${order.id} released after ${attemptCount} charge attempts that never produced a confirmed outcome (retry count ${order.paymentRetryCount}) — investigate the payment method, the customer was otherwise stuck`
          );
        }
        continue;
      }

      // Past this point we are deciding whether to CHARGE, and only a
      // `payment_failed` order is eligible. A `payment_pending` one still has
      // an attempt nobody has settled; charging it is the double charge.
      if (order.status !== "payment_failed") continue;

      if (order.window.deliveryDate <= now) continue; // delivered already — leave for an admin
      recordOutcome(result, await attemptCharge(order.id, now));
    } catch (err) {
      throwIfFatalConfig(err);
      result.errors++;
      console.error(`[cycle-run] retry for order ${order.id} threw:`, err);
    }
  }
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
  const { attemptId, orderId, now } = params;
  let outcome = params.outcome;

  // `processing` (Stripe has the money in flight) and `unknown` (our call
  // threw and told us nothing) are neither success nor failure. Both leave the
  // attempt `pending` and the order `payment_pending`, untouched, for the
  // reconciler — writing anything here would be inventing an answer.
  if (outcome.kind === "processing" || outcome.kind === "unknown") return "left_pending";

  // An intent sitting at `requires_action` is not dead, it is waiting. Left
  // alone it could be authenticated hours later and succeed — after we had
  // recorded a failure and charged again under the next attempt number, and
  // after the webhook had stopped being able to act on it, because the attempt
  // is no longer `pending`. Cancel it so it is established dead rather than
  // inferred dead.
  if (outcome.kind === "requires_action") {
    const afterCancel = await cancelPaymentIntent(outcome.paymentIntentId);
    // Only a success changes the story — the customer authenticated between
    // our read and our cancel, so we adopt the payment rather than discard it.
    // Any other answer leaves the `requires_action` resolution standing: it is
    // the truthful record of why this attempt ended, and the intent is now
    // confirmed dead rather than merely assumed so.
    if (afterCancel?.kind === "succeeded") outcome = afterCancel;
  }

  const plan = planFor(outcome, now);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentAttempt.updateMany({
      where: { id: attemptId, status: "pending" },
      data: plan.attempt,
    });
    if (claimed.count === 0) {
      // Someone else resolved this attempt first. Usually benign — a
      // redelivered webhook, or the reconciler and the charge path meeting.
      //
      // But if what we are holding is an ESTABLISHED SUCCESS and the resolved
      // row names a different intent (or none), then money moved and no row
      // records it. That is exactly the "payment taken, nothing to refund
      // against" shape this whole task exists to remove, and it is the one
      // anomaly here that must not be silent. The likeliest way in: the
      // reconciler abandons an attempt while the original call is still in
      // flight, and that call then returns `succeeded`.
      if (outcome.kind === "succeeded") {
        const existing = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
        if (existing && existing.stripePaymentIntentId !== outcome.paymentIntentId) {
          await tx.paymentAttempt.update({
            where: { id: attemptId },
            data: { orphanedPaymentIntentId: outcome.paymentIntentId },
          });
          console.error(
            `[payments] ORPHANED CHARGE: payment intent ${outcome.paymentIntentId} succeeded for order ${orderId}, but attempt ${attemptId} had already resolved as ${existing.status}` +
              (existing.stripePaymentIntentId ? ` against ${existing.stripePaymentIntentId}` : "") +
              " — money taken with no order recording it, REFUND MANUALLY"
          );
        }
      }
      return "already_resolved";
    }

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
      // Take ownership BEFORE any Stripe work. The cron route is a plain
      // handler on GET and POST with no lock, so two runs can overlap, read
      // the same stale attempt, both see the same duplicate charge and both
      // try to refund it. Claiming here is what makes the refund loop below
      // single-writer; `refundPaymentIntent`'s idempotency key is the second
      // line of defence, not the first.
      //
      // A timestamp rather than a status, so a run that dies mid-reconcile
      // releases the attempt by staleness instead of stranding it somewhere
      // the sweep no longer looks.
      const owned = await prisma.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "pending",
          OR: [{ reconcileStartedAt: null }, { reconcileStartedAt: { lt: staleBefore } }],
        },
        data: { reconcileStartedAt: now },
      });
      if (owned.count === 0) continue; // another run owns it

      const customerId = attempt.order.stripeCustomerId;
      if (!customerId) {
        // Resolve rather than skip. Leaving it pending was its own trap: the
        // order stays `payment_pending` for ever, outside every exit and
        // uncancellable by the customer.
        //
        // And it is not a guess. We cannot charge without a customer id and no
        // amount of reconciling will conjure one, so "this can never be paid"
        // is established, not inferred. Nor can it lead to a double charge:
        // the retry path needs the same missing id, so it fails the same way
        // until the retry budget runs out and the order is released.
        console.error(
          `[payments] attempt ${attempt.id} on order ${attempt.orderId} has no Stripe customer — it can never be charged, failing it`
        );
        const applied = await resolveChargeOutcome({
          attemptId: attempt.id,
          orderId: attempt.orderId,
          outcome: {
            kind: "failed",
            code: "no_stripe_customer",
            message: "The order has no Stripe customer, so it can never be charged",
          },
          now,
        });
        if (applied === "resolved") result.reconciled++;
        continue;
      }

      // Both ends anchored on the ATTEMPT, never on `now`. The write-ahead
      // ordering means the intent, if one exists, was created within seconds
      // of this row, so a fixed window either side of it always contains the
      // answer — and, unlike a window reaching back from now, it does not grow
      // as the attempt ages. That is what keeps the paging bounded: a search
      // range that widened daily would eventually sweep months of a customer's
      // PaymentIntents and hit the page limit.
      const since = new Date(
        attempt.createdAt.getTime() - PAYMENT_LOOKUP_BEFORE_MINUTES * 60 * 1000
      );
      const until = new Date(
        attempt.createdAt.getTime() + PAYMENT_LOOKUP_AFTER_HOURS * 60 * 60 * 1000
      );

      const intents = await findIntentsForAttempt({
        customerId,
        orderId: attempt.orderId,
        attemptNumber: attempt.attemptNumber,
        since,
        until,
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
      throwIfFatalConfig(err);
      result.errors++;
      // The attempt stays `pending` and its order stays `payment_pending`.
      // That is the correct terminal state when we cannot establish whether
      // money moved — but it must not be a silent one, so it is named here and
      // counted into the run result for whoever reads it.
      result.needsManualReview++;
      console.error(
        `[payments] NEEDS MANUAL REVIEW: could not establish what Stripe did with order ${attempt.orderId} attempt ${attempt.attemptNumber} (attempt id ${attempt.id}, customer ${attempt.order.stripeCustomerId ?? "none"}). The order stays payment_pending and is NOT being charged again or cancelled, because a charge may stand against the card. Reason:`,
        err
      );
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
  // Read first, so a claim that has to be released can be put back with the
  // timestamp it had rather than a guessed one.
  const before = await prisma.order.findUnique({ where: { id: orderId } });
  if (!before) return "claimedElsewhere";

  // Claim from each status separately rather than with one `in` filter. A
  // single `updateMany` reports how many rows it moved but not which status
  // they came from, and the release path below has to put the order back
  // exactly where it was: restoring a `payment_failed` order as `committed`
  // would re-enter the cutoff phase carrying a non-zero retry count.
  const claim = { status: "payment_pending", paymentAttemptedAt: now };
  let priorStatus = "committed";
  let claimed = await prisma.order.updateMany({
    where: { id: orderId, status: "committed" },
    data: claim,
  });
  if (claimed.count === 0) {
    claimed = await prisma.order.updateMany({
      where: { id: orderId, status: "payment_failed" },
      data: claim,
    });
    priorStatus = "payment_failed";
  }
  if (claimed.count === 0) return "claimedElsewhere";

  // Re-read now the claim is held: this is the authoritative state to charge
  // from, and nothing else can move it while we own it.
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  // No saved card. This is established without calling Stripe at all, so there
  // is nothing to reconcile later and no attempt row to write.
  if (!order.stripeCustomerId || !order.stripePaymentMethodId) {
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
      data: { status: priorStatus, paymentAttemptedAt: before.paymentAttemptedAt },
    });
    console.error(`[payments] could not open attempt ${attemptNumber} for order ${orderId}:`, err);
    return "claimedElsewhere";
  }

  let outcome: ChargeOutcome;
  try {
    outcome = await chargeOrder({
      orderId,
      attemptNumber,
      amountPence: order.totalPence,
      customerId: order.stripeCustomerId,
      paymentMethodId: order.stripePaymentMethodId,
      idempotencyKey,
    });
  } catch (err) {
    // Broken credentials are rejected at Stripe's door, so we know for certain
    // no PaymentIntent was created. Undo the write-ahead completely — the row
    // exists to record that a charge MIGHT have been made, and here it
    // certainly wasn't. A misconfigured deploy leaves no trace on the order.
    if (err instanceof PaymentConfigurationError) {
      await prisma.paymentAttempt.delete({ where: { id: attempt.id } });
      await prisma.order.updateMany({
        where: { id: orderId, status: "payment_pending" },
        data: { status: priorStatus, paymentAttemptedAt: before.paymentAttemptedAt },
      });
    }
    throw err;
  }

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
