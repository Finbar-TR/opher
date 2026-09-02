import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { runCycles } from "./cycle-run";
import { cutoffAtFor } from "./cycles";
import { chargeOrder } from "./payments";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

// Wrap the real chargeOrder (still hitting the keyless dev fallback, since
// ./stripe is mocked to null above) in a spy so individual tests can force a
// decline or a thrown error with mockImplementationOnce, while every other
// call keeps behaving exactly like production without a Stripe key.
vi.mock("./payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./payments")>();
  return { ...actual, chargeOrder: vi.fn(actual.chargeOrder) };
});

const TAG = "ZZTEST_CRON_" + Date.now();
const DELIVERY = new Date("2026-11-21T00:00:00Z");
const CUTOFF = cutoffAtFor(DELIVERY, 3); // 2026-11-18T08:00:00Z
const AT_CUTOFF = new Date("2026-11-18T08:00:00Z");

// There is no minimum-demand decision any more — every committed order is
// charged at the cutoff — so a scenario only needs enough to build one basket
// with N joiners. purchaseThresholdGrams/stockAt3pl/leadTimeDays remain
// required, non-null Sku columns but the cron never reads them.
async function scenario(opts: { tierGrams: number; joiners: number }) {
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
      tiers: { create: [{ label: "T", weightGrams: opts.tierGrams, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });

  const window = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate: DELIVERY, cutoffAt: CUTOFF, status: "open" },
  });

  for (let i = 0; i < opts.joiners; i++) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-${suffix}-${i}@test`, name: `U${i}`, passwordHash: "x" },
    });
    await prisma.order.create({
      data: {
        userId: u.id, basketId: basket.id, basketTierId: basket.tiers[0].id,
        deliveryWindowId: window.id, status: "committed",
        stripeCustomerId: "dev_cus_1", stripePaymentMethodId: "dev_pm_1",
        debitDate: CUTOFF, cancellationDeadline: CUTOFF,
        totalPence: 2200, deliveryAddress: "1 Test Street",
      },
    });
  }

  return { basketId: basket.id, windowId: window.id };
}

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("runCycles at the cutoff", () => {
  it("charges every committed order in a window once its cutoff arrives", async () => {
    const { basketId, windowId } = await scenario({ tierGrams: 10000, joiners: 12 });

    await runCycles(AT_CUTOFF);

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("locked");

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders).toHaveLength(12);
    expect(orders.every((o) => o.status === "paid")).toBe(true);
    expect(orders.every((o) => o.stripePaymentIntentId !== null)).toBe(true);
  });

  it("is idempotent — a second run charges nobody twice", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 12 });

    await runCycles(AT_CUTOFF);
    const intents = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);

    // `charged` is a run-wide counter over the shared dev.db, so it isn't
    // asserted directly here — a concurrently-running integration suite's own
    // fixtures could contribute to it. What actually matters, and what's
    // asserted, is that these specific orders' PaymentIntents are unchanged.
    await runCycles(AT_CUTOFF);

    const after = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);
    expect(after).toEqual(intents);
  });

  it("does nothing before the cutoff", async () => {
    const { basketId, windowId } = await scenario({ tierGrams: 10000, joiners: 12 });

    await runCycles(new Date("2026-11-17T08:00:00Z"));

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("open");
    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "committed")).toBe(true);
  });
});

describe("runCycles re-entrancy", () => {
  it("resumes a window a crashed run only partly charged", async () => {
    const { basketId, windowId } = await scenario({ tierGrams: 10000, joiners: 2 });
    const [already, stillCommitted] = await prisma.order.findMany({ where: { basketId } });

    // Simulate a crash: the cron reached this window and locked it, and
    // charged one of its two orders, but died before reaching the other.
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "locked" } });
    await prisma.order.update({
      where: { id: already.id },
      data: { status: "paid", stripePaymentIntentId: "dev_pi_precrash", paymentAttemptedAt: AT_CUTOFF },
    });

    await runCycles(AT_CUTOFF);

    const afterPending = await prisma.order.findUniqueOrThrow({ where: { id: stillCommitted.id } });
    expect(afterPending.status).toBe("paid");
    expect(afterPending.stripePaymentIntentId).not.toBeNull();

    // The order the "prior run" already resolved is left exactly as it was —
    // no re-decision, no second charge.
    const afterAlready = await prisma.order.findUniqueOrThrow({ where: { id: already.id } });
    expect(afterAlready.stripePaymentIntentId).toBe("dev_pi_precrash");
  });
});

describe("runCycles payment retries", () => {
  it("releases an order after the maximum retries", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 1 });
    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "payment_failed", paymentRetryCount: 3, paymentAttemptedAt: new Date() },
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.released).toBeGreaterThanOrEqual(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
  });

  it("releases an exhausted order even after its window has already been delivered (C1)", async () => {
    const { basketId, windowId } = await scenario({ tierGrams: 10000, joiners: 1 });
    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "payment_failed",
        paymentRetryCount: 3,
        paymentAttemptedAt: new Date("2026-11-15T08:00:00Z"),
      },
    });
    // The window has already been delivered by the time this run happens —
    // the old code bounded the whole retry sweep (release included) to
    // windows not yet delivered, so an order like this could never be
    // released, and joins.ts refuses to let the customer cancel it either
    // once paymentAttemptedAt is set. It must still be releasable.
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "dispatched" } });

    const result = await runCycles(new Date("2026-11-22T08:00:00Z"));
    expect(result.released).toBeGreaterThanOrEqual(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
  });

  it("retries a declined charge on a later run and it succeeds (I2)", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 1 });

    vi.mocked(chargeOrder).mockImplementationOnce(async () => ({ ok: false, error: "card_declined" }));
    await runCycles(AT_CUTOFF);

    const failedOrder = await prisma.order.findFirstOrThrow({ where: { basketId } });
    expect(failedOrder.status).toBe("payment_failed");
    expect(failedOrder.paymentRetryCount).toBe(1);

    // A later run, still before the window's delivery date — the mock's
    // failure was consumed by run 1, so this charge uses the real (always
    // succeeding) dev fallback.
    await runCycles(new Date("2026-11-19T08:00:00Z"));

    const after = await prisma.order.findUniqueOrThrow({ where: { id: failedOrder.id } });
    expect(after.status).toBe("paid");
    expect(after.paymentRetryCount).toBe(1);
  });
});

describe("runCycles failure isolation (C3)", () => {
  it("isolates a thrown charge error to one order and still charges the rest", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 2 });

    vi.mocked(chargeOrder).mockImplementationOnce(async () => {
      throw new Error("simulated DB hiccup");
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.errors).toBeGreaterThanOrEqual(1);

    const orders = await prisma.order.findMany({ where: { basketId } });
    // One order's charge threw; the other order in the same window must
    // still have been charged rather than the whole run aborting.
    expect(orders.some((o) => o.status === "paid")).toBe(true);
  });
});

describe("runCycles advance", () => {
  it("marks a window dispatched once its delivery date has passed", async () => {
    const { windowId } = await scenario({ tierGrams: 10000, joiners: 1 });
    await runCycles(new Date("2026-11-22T08:00:00Z"));
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("dispatched");
  });
});

describe("runCycles charge failures (C3)", () => {
  it("records a decline once and does not retry it again in the same run", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 1 });

    vi.mocked(chargeOrder).mockImplementationOnce(async () => ({ ok: false, error: "card_declined" }));

    await runCycles(AT_CUTOFF);

    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });
    // If phase 3 had picked this straight back up in the same run, the second
    // (unmocked, always-succeeding) call would have moved it to `paid` — so a
    // `payment_failed` order with exactly one retry recorded is direct proof
    // the same-run retry did not happen.
    expect(order.status).toBe("payment_failed");
    expect(order.paymentRetryCount).toBe(1);
    expect(order.paymentAttemptedAt).not.toBeNull();
  });
});

describe("runCycles payment_pending recovery (C2 — deliberately inert)", () => {
  it("reports a stranded payment_pending order without charging it again", async () => {
    const { basketId, windowId } = await scenario({ tierGrams: 10000, joiners: 1 });
    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });

    // Simulate the crash: the window is locked, but the order itself never
    // reached a terminal status — the process died between claiming it and
    // Stripe replying. Recovery does NOT know whether Stripe actually
    // charged the card, so charging again here risks a double charge — the
    // fix for that is a dedicated task (payment-attempt audit trail, webhook
    // reconciliation). Until then this must stay untouched and merely
    // reported.
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "locked" } });
    const staleAttempt = new Date(AT_CUTOFF.getTime() - 20 * 60 * 1000); // 20 min before cutoff
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "payment_pending", paymentAttemptedAt: staleAttempt },
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.strandedPending).toBeGreaterThanOrEqual(1);

    // `chargeOrder` is a run-wide spy, so rather than assert it was never
    // called at all (other fixtures sharing the run could call it), check
    // that none of the calls made were for THIS order's idempotency key.
    const calledForThisOrder = vi.mocked(chargeOrder).mock.calls
      .some(([params]) => params.idempotencyKey?.includes(order.id));
    expect(calledForThisOrder).toBe(false);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("payment_pending");
    expect(after.paymentRetryCount).toBe(0);
    expect(after.stripePaymentIntentId).toBeNull();
  });
});
