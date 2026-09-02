import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { joinBasket, cancelOrder, reconcileSetupIntent } from "./joins";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_JOIN_" + Date.now();
let cityId = "";
let basketId = "";
let openWindowId = "";
let lockedWindowId = "";
let tierId = "";
let userId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: { name: `${TAG} City`, slug: `${TAG}-city`.toLowerCase(), anchorDate: new Date("2026-09-05T00:00:00Z") },
  });
  cityId = city.id;
  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: { productId: product.id, label: "Yam", weightGrams: 25000, wholesaleCostPence: 4000, purchaseThresholdGrams: 100000 },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId, skuId: sku.id, label: `${TAG} Basket`, createdById: admin.id,
      tiers: { create: [{ label: "Medium", weightGrams: 5000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  basketId = basket.id;
  tierId = basket.tiers[0].id;

  const openDate = new Date("2026-12-19T00:00:00Z");
  const openWin = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: openDate, cutoffAt: cutoffAtFor(openDate, 3) },
  });
  openWindowId = openWin.id;

  const lockedDate = new Date("2026-12-05T00:00:00Z");
  const lockedWin = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: lockedDate, cutoffAt: cutoffAtFor(lockedDate, 3), status: "locked" },
  });
  lockedWindowId = lockedWin.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}-mem@test`, name: "Mem", passwordHash: "x" },
  });
  userId = user.id;
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

const joinArgs = () => ({
  userId,
  basketId,
  tierId,
  deliveryAddress: "1 Test Street, S1 1AA",
  setupIntentId: `dev_seti_${Math.random().toString(16).slice(2)}`,
  paymentMethodId: "dev_pm_1",
  stripeCustomerId: "dev_cus_1",
});

describe("joinBasket", () => {
  it("creates a committed order against the next open window", async () => {
    const { orderId } = await joinBasket({ ...joinArgs(), utm: { source: "meta", campaign: "yam-friday" } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    expect(order.status).toBe("committed");
    expect(order.deliveryWindowId).toBe(openWindowId);
    expect(order.totalPence).toBe(2200);
    expect(order.utmSource).toBe("meta");
    expect(order.utmCampaign).toBe("yam-friday");
  });

  it("sets debit date and cancellation deadline to the window cutoff", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { basketId, userId } });
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: openWindowId } });
    expect(order.debitDate.toISOString()).toBe(win.cutoffAt.toISOString());
    expect(order.cancellationDeadline.toISOString()).toBe(win.cutoffAt.toISOString());
  });

  it("refuses a second join to the same basket and cycle", async () => {
    await expect(joinBasket(joinArgs())).rejects.toThrow(/already joined/i);
  });

  it("refuses when the basket is paused", async () => {
    const other = await prisma.user.create({ data: { email: `${TAG}-p@test`, name: "P", passwordHash: "x" } });
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    await expect(joinBasket({ ...joinArgs(), userId: other.id })).rejects.toThrow(/not open/i);
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });

  it("refuses when no window is open", async () => {
    const other = await prisma.user.create({ data: { email: `${TAG}-n@test`, name: "N", passwordHash: "x" } });
    await prisma.deliveryWindow.update({ where: { id: openWindowId }, data: { status: "locked" } });
    await expect(joinBasket({ ...joinArgs(), userId: other.id })).rejects.toThrow(/closed/i);
    await prisma.deliveryWindow.update({ where: { id: openWindowId }, data: { status: "open" } });
  });
});

describe("cancelOrder", () => {
  it("cancels before the deadline", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { basketId, userId } });
    await cancelOrder(order.id, userId, new Date("2026-12-01T00:00:00Z"));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
    expect(after.stripePaymentMethodId).toBeNull();
  });

  it("refuses after the deadline", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-late@test`, name: "L", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: u.id });
    await expect(cancelOrder(orderId, u.id, new Date("2026-12-18T00:00:00Z"))).rejects.toThrow(/deadline/i);
  });

  it("refuses once a charge has been attempted", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-chg@test`, name: "C", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: u.id });
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "payment_failed", paymentAttemptedAt: new Date() },
    });
    await expect(cancelOrder(orderId, u.id, new Date("2026-12-01T00:00:00Z"))).rejects.toThrow(/cannot be cancelled/i);
  });

  it("refuses to cancel someone else's order", async () => {
    const owner = await prisma.user.create({ data: { email: `${TAG}-own@test`, name: "O", passwordHash: "x" } });
    const stranger = await prisma.user.create({ data: { email: `${TAG}-str@test`, name: "S", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: owner.id });
    await expect(cancelOrder(orderId, stranger.id, new Date("2026-12-01T00:00:00Z"))).rejects.toThrow();
  });

  it("lets a cancelled joiner rejoin the same cycle", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-again@test`, name: "A", passwordHash: "x" } });
    const first = await joinBasket({ ...joinArgs(), userId: u.id });
    await cancelOrder(first.orderId, u.id, new Date("2026-12-01T00:00:00Z"));

    const second = await joinBasket({ ...joinArgs(), userId: u.id });
    expect(second.orderId).toBe(first.orderId); // the row is reused
    const order = await prisma.order.findUniqueOrThrow({ where: { id: second.orderId } });
    expect(order.status).toBe("committed");
    expect(order.stripePaymentMethodId).toBe("dev_pm_1");
  });
});

describe("reconcileSetupIntent", () => {
  it("fills in a payment method the join request did not record", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-rec@test`, name: "R", passwordHash: "x" } });
    const args = joinArgs();
    const { orderId } = await joinBasket({ ...args, userId: u.id });
    await prisma.order.update({ where: { id: orderId }, data: { stripePaymentMethodId: null } });

    await reconcileSetupIntent(args.setupIntentId, "dev_pm_recovered");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.stripePaymentMethodId).toBe("dev_pm_recovered");
  });

  it("leaves an already-recorded payment method alone", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-rec2@test`, name: "R2", passwordHash: "x" } });
    const args = joinArgs();
    const { orderId } = await joinBasket({ ...args, userId: u.id });

    await reconcileSetupIntent(args.setupIntentId, "dev_pm_other");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.stripePaymentMethodId).toBe("dev_pm_1");
  });

  it("is a no-op for a setup intent with no order", async () => {
    await expect(reconcileSetupIntent("dev_seti_orphan", "dev_pm_x")).resolves.toBeUndefined();
  });
});
