import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import type Stripe from "stripe";
import { prisma } from "./prisma";
import { runCycles } from "./cycle-run";
import { chargeOrder, findIntentsForAttempt, refundPaymentIntent } from "./payments";

// Reconciliation of interrupted charge attempts.
//
// The premise every test here shares: the cron claimed an order, wrote a
// `pending` PaymentAttempt, called Stripe, and then died — a Vercel timeout,
// a lost socket. Our database cannot say whether the money moved. Stripe can.
// So the reconciler asks Stripe and adopts the answer; it never charges, and
// it never guesses.

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

// `outcomeFromIntent` is deliberately left real — it is the mapping under test
// as much as the reconciler is. Only the two calls that reach Stripe's network
// are replaced.
vi.mock("./payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payments")>();
  return {
    ...actual,
    chargeOrder: vi.fn(actual.chargeOrder),
    findIntentsForAttempt: vi.fn(async () => []),
    refundPaymentIntent: vi.fn(async () => {}),
  };
});

const TAG = "ZZTEST_RECON_" + Date.now();
const NOW = new Date("2026-12-10T08:00:00Z");
// Both are comfortably in the future, so the cutoff and retry phases have no
// interest in these orders. Phase 0 is the only thing acting on them.
const DELIVERY = new Date("2026-12-20T00:00:00Z");
const CUTOFF = new Date("2026-12-17T08:00:00Z");

const STALE = new Date(NOW.getTime() - 60 * 60 * 1000); // an hour ago — reconcilable
const FRESH = new Date(NOW.getTime() - 60 * 1000); // a minute ago — still in flight

// A minimal PaymentIntent: the reconciler reads `id` and `status`, and
// `outcomeFromIntent` reads `last_payment_error`.
const intent = (
  id: string,
  status: Stripe.PaymentIntent.Status,
  lastError?: { code?: string; message?: string }
) => ({ id, status, last_payment_error: lastError }) as unknown as Stripe.PaymentIntent;

// Answer for one order only. `runCycles` sweeps the whole shared dev.db, so any
// other pending attempt in the file must keep getting the default empty answer.
function stripeHolds(orderId: string, intents: Stripe.PaymentIntent[]) {
  vi.mocked(findIntentsForAttempt).mockImplementation(async (params) =>
    params.orderId === orderId ? intents : []
  );
}

const chargedThisOrder = (orderId: string) =>
  vi.mocked(chargeOrder).mock.calls.some(([params]) => params.orderId === orderId);

const lookedUpThisOrder = (orderId: string) =>
  vi.mocked(findIntentsForAttempt).mock.calls.some(([params]) => params.orderId === orderId);

// An order mid-charge: claimed, `payment_pending`, with a `pending` attempt row
// whose age decides whether the reconciler considers it interrupted.
async function strandedOrder(opts: { attemptCreatedAt: Date; retryCount?: number }) {
  const suffix = Math.random().toString(16).slice(2, 8);
  const city = await prisma.city.create({
    data: {
      name: `${TAG} ${suffix}`,
      slug: `${TAG}-${suffix}`.toLowerCase(),
      anchorDate: DELIVERY,
      active: false, // keep ensureOpenWindows out of these fixtures
    },
  });
  const product = await prisma.product.create({ data: { name: `${TAG} ${suffix} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4000,
      purchaseThresholdGrams: 0,
      stockAt3pl: 0,
      leadTimeDays: 2,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-${suffix}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId: city.id, skuId: sku.id, label: `${TAG} ${suffix}`, createdById: admin.id,
      tiers: { create: [{ label: "T", weightGrams: 10000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  const window = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate: DELIVERY, cutoffAt: CUTOFF, status: "locked" },
  });
  const user = await prisma.user.create({
    data: { email: `${TAG}-${suffix}-u@test`, name: "U", passwordHash: "x" },
  });

  const order = await prisma.order.create({
    data: {
      userId: user.id, basketId: basket.id, basketTierId: basket.tiers[0].id,
      deliveryWindowId: window.id,
      status: "payment_pending",
      stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test",
      debitDate: CUTOFF, cancellationDeadline: CUTOFF,
      paymentAttemptedAt: opts.attemptCreatedAt,
      paymentRetryCount: opts.retryCount ?? 0,
      totalPence: 2200, deliveryAddress: "1 Test Street",
    },
  });

  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      attemptNumber: 0,
      idempotencyKey: `order-${order.id}-attempt-0`,
      status: "pending",
      createdAt: opts.attemptCreatedAt,
    },
  });

  return { orderId: order.id, attemptId: attempt.id };
}

beforeEach(() => {
  // mockClear, not mockReset: the factory seeded chargeOrder with the real
  // keyless implementation and these tests rely on it staying there.
  vi.mocked(chargeOrder).mockClear();
  vi.mocked(findIntentsForAttempt).mockReset();
  vi.mocked(findIntentsForAttempt).mockResolvedValue([]);
  vi.mocked(refundPaymentIntent).mockReset();
  vi.mocked(refundPaymentIntent).mockResolvedValue(undefined);
});

afterAll(async () => {
  await prisma.paymentAttempt.deleteMany({
    where: { order: { basket: { city: { name: { startsWith: TAG } } } } },
  });
  await prisma.order.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("reconciling an interrupted charge", () => {
  // THE double-charge case, and the reason this whole task exists. Stripe took
  // the money; the process died before we recorded it. The old recovery
  // assumed the charge had failed and ran it again, and by then the
  // idempotency key had expired, so Stripe happily charged the card a second
  // time — with no payment reference stored to refund against.
  it("adopts a charge Stripe already took instead of making it again", async () => {
    const { orderId, attemptId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, [intent("pi_taken", "succeeded")]);

    const result = await runCycles(NOW);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paid");
    expect(order.stripePaymentIntentId).toBe("pi_taken");
    // The customer's retry budget is untouched: no try was spent finding out
    // what had already happened.
    expect(order.paymentRetryCount).toBe(0);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("succeeded");
    expect(attempt.stripePaymentIntentId).toBe("pi_taken");
    expect(attempt.resolvedAt).not.toBeNull();

    // The whole point: not one new charge was attempted for this order.
    expect(chargedThisOrder(orderId)).toBe(false);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);
  });

  it("frees an order for a fresh attempt when the request never reached Stripe", async () => {
    const { orderId, attemptId } = await strandedOrder({ attemptCreatedAt: STALE, retryCount: 1 });
    stripeHolds(orderId, []);

    await runCycles(NOW);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("abandoned");
    expect(attempt.resolvedAt).not.toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("payment_failed");
    // Unchanged, not reset: Stripe positively holds nothing, so nothing was
    // spent — not the customer's money, and not one of their three tries.
    expect(order.paymentRetryCount).toBe(1);

    // Reconciliation establishes the truth; it does not charge. The retry
    // phase owns that, on the next run.
    expect(chargedThisOrder(orderId)).toBe(false);
  });

  // The abandoned attempt keeps its number and its (now used) idempotency key
  // forever, so the next attempt has to get a different one or the order is
  // deadlocked: a reused key collides on the unique constraint and the runner
  // stops, every run, for good. Attempt numbers therefore count attempts, not
  // retries — the two diverge precisely because abandonment spends no retry.
  it("charges again under a fresh attempt number after abandoning one", async () => {
    const { orderId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, []);

    await runCycles(NOW);
    await runCycles(new Date("2026-12-11T08:00:00Z")); // the next daily run

    const attempts = await prisma.paymentAttempt.findMany({
      where: { orderId },
      orderBy: { attemptNumber: "asc" },
    });
    expect(attempts.map((a) => a.attemptNumber)).toEqual([0, 1]);
    expect(attempts.map((a) => a.status)).toEqual(["abandoned", "succeeded"]);
    expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(2);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paid");
    // One real charge, and it only ever happened because Stripe said no
    // payment existed.
    expect(chargedThisOrder(orderId)).toBe(true);
    expect(vi.mocked(chargeOrder).mock.calls.filter(([p]) => p.orderId === orderId)).toHaveLength(1);
  });

  it("refunds a duplicate charge and keeps one", async () => {
    const { orderId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, [
      intent("pi_kept", "succeeded"),
      intent("pi_duplicate", "succeeded"),
    ]);

    const result = await runCycles(NOW);

    expect(vi.mocked(refundPaymentIntent).mock.calls).toEqual([["pi_duplicate"]]);
    expect(result.duplicatesRefunded).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paid");
    expect(order.stripePaymentIntentId).toBe("pi_kept");
  });

  // `processing` is neither success nor failure. Releasing the order would
  // strand a payment that is about to succeed; failing it would charge the
  // customer twice. The only correct action is none.
  it("leaves an intent that is still processing exactly as it is", async () => {
    const { orderId, attemptId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, [intent("pi_inflight", "processing")]);

    await runCycles(NOW);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("pending");
    expect(attempt.resolvedAt).toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("payment_pending");
    expect(order.paymentRetryCount).toBe(0);
    expect(chargedThisOrder(orderId)).toBe(false);
    expect(vi.mocked(refundPaymentIntent)).not.toHaveBeenCalled();
  });

  it("records requires_action as a spent try, preserving the reason", async () => {
    const { orderId, attemptId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, [
      intent("pi_sca", "requires_action", {
        code: "authentication_required",
        message: "This card requires authentication.",
      }),
    ]);

    await runCycles(NOW);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("requires_action");
    expect(attempt.errorCode).toBe("authentication_required");
    expect(attempt.stripePaymentIntentId).toBe("pi_sca");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("payment_failed");
    // Established by Stripe, so it does count against the retry budget.
    expect(order.paymentRetryCount).toBe(1);
  });

  // An attempt that is merely young is a charge still legitimately in flight,
  // not an interrupted one. Reconciling it would race our own in-progress call.
  it("does not touch an attempt that is not yet stale", async () => {
    const { orderId, attemptId } = await strandedOrder({ attemptCreatedAt: FRESH });
    stripeHolds(orderId, [intent("pi_should_not_be_read", "succeeded")]);

    await runCycles(NOW);

    expect(lookedUpThisOrder(orderId)).toBe(false);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("pending");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("payment_pending");
    expect(order.paymentRetryCount).toBe(0);
  });

  // Reconciliation is idempotent: a second run finds nothing left pending, so
  // it must not re-adopt, re-refund, or re-increment anything.
  it("is idempotent across runs", async () => {
    const { orderId } = await strandedOrder({ attemptCreatedAt: STALE });
    stripeHolds(orderId, [intent("pi_once", "succeeded")]);

    await runCycles(NOW);
    await runCycles(NOW);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paid");
    expect(order.stripePaymentIntentId).toBe("pi_once");
    expect(order.paymentRetryCount).toBe(0);
    expect(vi.mocked(refundPaymentIntent)).not.toHaveBeenCalled();
    expect(chargedThisOrder(orderId)).toBe(false);
  });
});
