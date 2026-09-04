import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { demandedGrams } from "./demand";
import { ensureOpenWindows } from "./windows";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_DEMAND_" + Date.now();
let cityId = "";
let basketId = "";
let windowId = "";
let smallTierId = "";
let largeTierId = "";

async function joiner(suffix: string) {
  return prisma.user.create({
    data: { email: `${TAG}-${suffix}@test`, name: suffix, passwordHash: "x" },
  });
}

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} City`,
      slug: `${TAG}-city`.toLowerCase(),
      anchorDate: new Date("2026-09-05T00:00:00Z"),
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4000,
      purchaseThresholdGrams: 100000,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });

  const basket = await prisma.basket.create({
    data: {
      cityId,
      skuId: sku.id,
      label: `${TAG} Basket`,
      createdById: admin.id,
      tiers: {
        create: [
          { label: "Small", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
          { label: "Large", weightGrams: 10000, pricePence: 4000, displayOrder: 2 },
        ],
      },
    },
    include: { tiers: { orderBy: { displayOrder: "asc" } } },
  });
  basketId = basket.id;
  smallTierId = basket.tiers[0].id;
  largeTierId = basket.tiers[1].id;

  const deliveryDate = new Date("2026-09-19T00:00:00Z");
  const w = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 3) },
  });
  windowId = w.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basketId } });
  await prisma.demandSnapshot.deleteMany({ where: { basketId } });
  await prisma.basketTier.deleteMany({ where: { basketId } });
  await prisma.basket.deleteMany({ where: { id: basketId } });
  await prisma.purchaseOrder.deleteMany({ where: { sku: { product: { name: { startsWith: TAG } } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

async function join(userId: string, tierId: string, status: string) {
  const tier = await prisma.basketTier.findUniqueOrThrow({ where: { id: tierId } });
  const w = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
  return prisma.order.create({
    data: {
      userId,
      basketId,
      basketTierId: tierId,
      deliveryWindowId: windowId,
      status,
      debitDate: w.cutoffAt,
      cancellationDeadline: w.cutoffAt,
      totalPence: tier.pricePence,
      deliveryAddress: "1 Test Street",
    },
  });
}

describe("demandedGrams", () => {
  it("is zero for a basket nobody has joined", async () => {
    expect(await demandedGrams(basketId, windowId)).toBe(0);
  });

  it("sums tier weights across counted statuses", async () => {
    const a = await joiner("a");
    const b = await joiner("b");
    const c = await joiner("c");
    await join(a.id, smallTierId, "committed"); // 2000
    await join(b.id, largeTierId, "paid"); // 10000
    await join(c.id, largeTierId, "payment_pending"); // 10000
    expect(await demandedGrams(basketId, windowId)).toBe(22000);
  });

  it("excludes cancelled, refunded and failed orders", async () => {
    const d = await joiner("d");
    const e = await joiner("e");
    const f = await joiner("f");
    await join(d.id, largeTierId, "cancelled");
    await join(e.id, largeTierId, "refunded");
    await join(f.id, largeTierId, "payment_failed");
    expect(await demandedGrams(basketId, windowId)).toBe(22000);
  });
});

describe("ensureOpenWindows", () => {
  it("opens two windows ahead for an active city", async () => {
    const now = new Date("2026-09-20T09:00:00Z");
    await ensureOpenWindows(now);
    const open = await prisma.deliveryWindow.findMany({
      where: { cityId, status: "open", deliveryDate: { gte: now } },
      orderBy: { deliveryDate: "asc" },
    });
    expect(open).toHaveLength(2);
    expect(open[0].deliveryDate.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(open[0].cutoffAt.toISOString()).toBe("2026-09-30T08:00:00.000Z");
  });

  it("is idempotent — a second run creates nothing", async () => {
    const now = new Date("2026-09-20T09:00:00Z");
    const second = await ensureOpenWindows(now);
    expect(second.created).toBe(0);
  });

  it("creates nothing for an inactive city", async () => {
    await prisma.city.update({ where: { id: cityId }, data: { active: false } });
    const before = await prisma.deliveryWindow.count({ where: { cityId } });

    // A date far enough ahead that the series would otherwise need new windows.
    await ensureOpenWindows(new Date("2027-03-01T09:00:00Z"));

    expect(await prisma.deliveryWindow.count({ where: { cityId } })).toBe(before);
    await prisma.city.update({ where: { id: cityId }, data: { active: true } });
  });

  it("opens a window locked when its cutoff has already passed", async () => {
    // Anchor in the past: the next series date is behind us, so its cutoff is too.
    const past = await prisma.city.create({
      data: {
        name: `${TAG} Past`,
        slug: `${TAG}-past`.toLowerCase(),
        anchorDate: new Date("2026-09-05T00:00:00Z"),
      },
    });
    await ensureOpenWindows(new Date("2026-09-18T09:00:00Z"));
    const w = await prisma.deliveryWindow.findFirstOrThrow({
      where: { cityId: past.id },
      orderBy: { deliveryDate: "asc" },
    });
    // Delivery 2026-09-19, cutoff 2026-09-16 08:00 — already gone.
    expect(w.status).toBe("locked");
  });
});
