import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { runCycles } from "./cycle-run";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_CRON_" + Date.now();
const DELIVERY = new Date("2026-11-21T00:00:00Z");
const CUTOFF = cutoffAtFor(DELIVERY, 3); // 2026-11-18T08:00:00Z
const AT_CUTOFF = new Date("2026-11-18T08:00:00Z");

let skuId = "";
let adminId = "";
let cityId = "";

// Each test builds its own city so runs cannot interfere.
async function scenario(opts: {
  tierGrams: number;
  joiners: number;
  threshold: number;
  stockAt3pl?: number;
  leadTimeDays?: number;
}) {
  const suffix = Math.random().toString(16).slice(2, 8);
  const city = await prisma.city.create({
    data: {
      name: `${TAG} ${suffix}`,
      slug: `${TAG}-${suffix}`.toLowerCase(),
      anchorDate: DELIVERY,
      active: false, // keep ensureOpenWindows out of these fixtures
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} ${suffix} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4000,
      purchaseThresholdGrams: opts.threshold,
      stockAt3pl: opts.stockAt3pl ?? 0,
      leadTimeDays: opts.leadTimeDays ?? 2,
    },
  });
  skuId = sku.id;

  const admin = await prisma.user.create({
    data: { email: `${TAG}-${suffix}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  adminId = admin.id;

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

  return { basketId: basket.id, windowId: window.id, skuId: sku.id };
}

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.demandSnapshot.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.purchaseOrder.deleteMany({ where: { sku: { product: { name: { startsWith: TAG } } } } });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("runCycles at the cutoff", () => {
  it("confirms, charges and raises a PO when demand clears the threshold", async () => {
    const { basketId, windowId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.confirmed).toBe(1);
    expect(result.charged).toBe(12);

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("locked");

    const snap = await prisma.demandSnapshot.findFirstOrThrow({ where: { basketId, windowId } });
    expect(snap.outcome).toBe("confirmed");
    expect(snap.demandedGramsAtDecision).toBe(120000);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "paid")).toBe(true);
    expect(orders.every((o) => o.stripePaymentIntentId !== null)).toBe(true);

    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { skuId, windowId } });
    expect(po.quantityGrams).toBe(120000);
    expect(po.status).toBe("pending");
  });

  it("fails the cycle below the threshold and charges nobody", async () => {
    const { basketId, windowId } = await scenario({
      tierGrams: 2000, joiners: 3, threshold: 100000,
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const snap = await prisma.demandSnapshot.findFirstOrThrow({ where: { basketId, windowId } });
    expect(snap.outcome).toBe("failed");

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "cancelled")).toBe(true);
    expect(orders.every((o) => o.paymentAttemptedAt === null)).toBe(true);
  });

  it("fails without charging when supply is not feasible", async () => {
    const { basketId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
      stockAt3pl: 0, leadTimeDays: 30,
    });

    await runCycles(AT_CUTOFF);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "cancelled")).toBe(true);
    expect(orders.every((o) => o.paymentAttemptedAt === null)).toBe(true);
  });

  it("raises no PO when held stock covers demand", async () => {
    const { basketId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000, stockAt3pl: 200000, leadTimeDays: 30,
    });

    await runCycles(AT_CUTOFF);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "paid")).toBe(true);
    expect(await prisma.purchaseOrder.count({ where: { skuId } })).toBe(0);

    // Stock is not moved by the decision itself.
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
    expect(sku.stockAt3pl).toBe(200000);
  });

  it("is idempotent — a second run charges nobody twice and adds no PO", async () => {
    const { basketId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    await runCycles(AT_CUTOFF);
    const intents = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);

    const second = await runCycles(AT_CUTOFF);
    expect(second.confirmed).toBe(0);
    expect(second.charged).toBe(0);
    expect(await prisma.purchaseOrder.count({ where: { skuId } })).toBe(1);

    const after = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);
    expect(after).toEqual(intents);
  });

  it("does nothing before the cutoff", async () => {
    const { basketId, windowId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    await runCycles(new Date("2026-11-17T08:00:00Z"));

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("open");
    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "committed")).toBe(true);
  });
});

describe("runCycles payment retries", () => {
  it("releases an order after the maximum retries", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 1, threshold: 100000 });
    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "payment_failed", paymentRetryCount: 3, paymentAttemptedAt: new Date() },
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.released).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
  });
});

describe("runCycles advance", () => {
  it("marks a window dispatched once its delivery date has passed", async () => {
    const { windowId } = await scenario({ tierGrams: 10000, joiners: 1, threshold: 1 });
    await runCycles(new Date("2026-11-22T08:00:00Z"));
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("dispatched");
  });
});
