import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import {
  listOpenBaskets,
  getBasketDetail,
  listUserOrders,
  getUserOrder,
} from "./basket-views";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_VIEWS_" + Date.now();
let citySlug = "";
let basketId = "";
let windowId = "";
let userId = "";
let orderId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} Leeds`,
      slug: `${TAG}-leeds`.toLowerCase(),
      anchorDate: new Date("2026-09-05T00:00:00Z"),
      cutoffDays: 4, // deliberately NOT the default, so copy can't hardcode 3
    },
  });
  citySlug = city.slug;

  const product = await prisma.product.create({
    data: { name: `${TAG} Yam`, description: "Ambient-stable white yam." },
  });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4200,
      purchaseThresholdGrams: 1,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });

  const basket = await prisma.basket.create({
    data: {
      cityId: city.id,
      skuId: sku.id,
      label: `${TAG} Yam — Leeds`,
      createdById: admin.id,
      tiers: {
        create: [
          { label: "Small (2 kg)", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
          { label: "Large (10 kg)", weightGrams: 10000, pricePence: 4000, displayOrder: 2 },
        ],
      },
    },
    include: { tiers: { orderBy: { displayOrder: "asc" } } },
  });
  basketId = basket.id;

  const deliveryDate = new Date("2026-12-19T00:00:00Z");
  const win = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 4) },
  });
  windowId = win.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}-mem@test`, name: "Mem", passwordHash: "x" },
  });
  userId = user.id;

  const order = await prisma.order.create({
    data: {
      userId,
      basketId,
      basketTierId: basket.tiers[1].id,
      deliveryWindowId: windowId,
      status: "committed",
      debitDate: win.cutoffAt,
      cancellationDeadline: win.cutoffAt,
      totalPence: 4000,
      deliveryAddress: "1 Test Street, Leeds LS1 1AA",
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basketId } });
  await prisma.basketTier.deleteMany({ where: { basketId } });
  await prisma.basket.deleteMany({ where: { id: basketId } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("listOpenBaskets", () => {
  it("returns the basket with its price range, window and social proof", async () => {
    const cards = await listOpenBaskets(citySlug);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.id).toBe(basketId);
    expect(c.minPricePence).toBe(950);
    expect(c.maxPricePence).toBe(4000);
    expect(c.windowId).toBe(windowId);
    expect(c.joiners).toBe(1);
    expect(c.grams).toBe(10000);
    expect(c.cutoffDays).toBe(4); // comes from the city, not a constant
  });

  it("filters by city", async () => {
    expect(await listOpenBaskets("no-such-city")).toHaveLength(0);
  });

  it("omits a paused basket", async () => {
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    expect(await listOpenBaskets(citySlug)).toHaveLength(0);
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });

  it("omits a basket whose window has locked", async () => {
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "locked" } });
    expect(await listOpenBaskets(citySlug)).toHaveLength(0);
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "open" } });
  });
});

describe("getBasketDetail", () => {
  it("returns tiers sorted, with price per kg", async () => {
    const d = await getBasketDetail(basketId);
    expect(d).not.toBeNull();
    expect(d!.tiers.map((t) => t.label)).toEqual(["Small (2 kg)", "Large (10 kg)"]);
    // 950p for 2kg = 475p/kg; 4000p for 10kg = 400p/kg
    expect(d!.tiers[0].pricePerKgPence).toBe(475);
    expect(d!.tiers[1].pricePerKgPence).toBe(400);
  });

  it("returns null for an unknown basket", async () => {
    expect(await getBasketDetail("nope")).toBeNull();
  });

  it("omits inactive tiers", async () => {
    const tier = await prisma.basketTier.findFirstOrThrow({ where: { basketId } });
    await prisma.basketTier.update({ where: { id: tier.id }, data: { active: false } });
    const d = await getBasketDetail(basketId);
    expect(d!.tiers).toHaveLength(1);
    await prisma.basketTier.update({ where: { id: tier.id }, data: { active: true } });
  });
});

describe("listUserOrders", () => {
  it("returns the user's order with cancellability", async () => {
    const orders = await listUserOrders(userId);
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(orderId);
    expect(orders[0].tierLabel).toBe("Large (10 kg)");
    expect(orders[0].totalPence).toBe(4000);
    expect(orders[0].canCancel).toBe(true);
  });

  it("marks a charged order as not cancellable", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: "paid" } });
    const orders = await listUserOrders(userId);
    expect(orders[0].canCancel).toBe(false);
    await prisma.order.update({ where: { id: orderId }, data: { status: "committed" } });
  });

  it("returns nothing for a different user", async () => {
    expect(await listUserOrders("someone-else")).toHaveLength(0);
  });
});

describe("getUserOrder", () => {
  it("returns the order for its owner", async () => {
    expect((await getUserOrder(orderId, userId))!.id).toBe(orderId);
  });

  it("returns null for a different user", async () => {
    expect(await getUserOrder(orderId, "someone-else")).toBeNull();
  });
});
