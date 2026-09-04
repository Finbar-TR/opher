import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { refundOrder, refundWindow } from "./refunds";
import { demandedGrams } from "./demand";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_REFUND_" + Date.now();
let basketId = "";
let windowId = "";
let cityId = "";
let paidOrderId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} City`,
      slug: `${TAG}-city`.toLowerCase(),
      anchorDate: new Date("2026-09-05T00:00:00Z"),
      active: false,
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
      purchaseThresholdGrams: 1,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId,
      skuId: sku.id,
      label: `${TAG} B`,
      createdById: admin.id,
      tiers: { create: [{ label: "T", weightGrams: 5000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  basketId = basket.id;

  const deliveryDate = new Date("2026-11-21T00:00:00Z");
  const win = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 3), status: "locked" },
  });
  windowId = win.id;

  for (let i = 0; i < 3; i++) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-${i}@test`, name: `U${i}`, passwordHash: "x" },
    });
    const o = await prisma.order.create({
      data: {
        userId: u.id,
        basketId,
        basketTierId: basket.tiers[0].id,
        deliveryWindowId: windowId,
        status: "paid",
        stripePaymentIntentId: `dev_pi_${i}`,
        debitDate: win.cutoffAt,
        cancellationDeadline: win.cutoffAt,
        totalPence: 2200,
        deliveryAddress: "1 Test Street",
      },
    });
    if (i === 0) paidOrderId = o.id;
  }
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basketId } });
  await prisma.basketTier.deleteMany({ where: { basketId } });
  await prisma.basket.deleteMany({ where: { id: basketId } });
  await prisma.deliveryWindow.deleteMany({ where: { cityId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("refundOrder", () => {
  it("marks a paid order refunded", async () => {
    await refundOrder(paidOrderId);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });
    expect(after.status).toBe("refunded");
  });

  it("removes the order from demand", async () => {
    // Two paid orders remain at 5000g each.
    expect(await demandedGrams(basketId, windowId)).toBe(10000);
  });

  it("refuses an order that was never charged", async () => {
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    const tier = await prisma.basketTier.findFirstOrThrow({ where: { basketId } });
    const fresh = await prisma.user.create({
      data: { email: `${TAG}-fresh@test`, name: "F", passwordHash: "x" },
    });
    const uncharged = await prisma.order.create({
      data: {
        userId: fresh.id,
        basketId,
        basketTierId: tier.id,
        deliveryWindowId: windowId,
        status: "committed",
        debitDate: win.cutoffAt,
        cancellationDeadline: win.cutoffAt,
        totalPence: 2200,
        deliveryAddress: "1 Test Street",
      },
    });
    await expect(refundOrder(uncharged.id)).rejects.toThrow(/not been charged/i);
  });
});

describe("refundWindow", () => {
  it("refunds every remaining paid order in the window", async () => {
    const result = await refundWindow(windowId);
    expect(result.refunded).toBe(2);
    const paid = await prisma.order.count({ where: { deliveryWindowId: windowId, status: "paid" } });
    expect(paid).toBe(0);
  });

  it("is idempotent — a second call refunds nothing", async () => {
    expect((await refundWindow(windowId)).refunded).toBe(0);
  });
});
