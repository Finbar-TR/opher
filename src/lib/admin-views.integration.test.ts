import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { formatKg } from "./weight";
import { listAdminBaskets, listUpcomingCycles, listWindowOrders } from "./admin-views";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_ADMIN_" + Date.now();
let basketId = "";
let windowId = "";
let cityId = "";
let paidOrderId = "";

// Delivery 2026-12-19, cutoff 4 days earlier at 08:00 UTC = 2026-12-15T08:00Z.
const DELIVERY = new Date("2026-12-19T00:00:00Z");

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} Leeds`,
      slug: `${TAG}-leeds`.toLowerCase(),
      anchorDate: DELIVERY,
      cutoffDays: 4,
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "25 kg crate",
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
      cityId,
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

  const win = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: DELIVERY, cutoffAt: cutoffAtFor(DELIVERY, 4) },
  });
  windowId = win.id;

  // Three joiners: 10 + 10 + 2 = 22 kg. One paid (refundable), two committed.
  const specs = [
    { tier: 1, status: "paid", pi: "dev_pi_1" },
    { tier: 1, status: "committed", pi: null },
    { tier: 0, status: "committed", pi: null },
  ];
  for (const [i, s] of specs.entries()) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-m${i}@test`, name: `Member ${i}`, passwordHash: "x" },
    });
    const o = await prisma.order.create({
      data: {
        userId: u.id,
        basketId,
        basketTierId: basket.tiers[s.tier].id,
        deliveryWindowId: windowId,
        status: s.status,
        stripePaymentIntentId: s.pi,
        debitDate: win.cutoffAt,
        cancellationDeadline: win.cutoffAt,
        totalPence: s.tier === 1 ? 4000 : 950,
        deliveryAddress: "1 Test Street, Leeds",
      },
    });
    if (s.status === "paid") paidOrderId = o.id;
  }

  // A cancelled order must not count anywhere.
  const cancelled = await prisma.user.create({
    data: { email: `${TAG}-x@test`, name: "Gone", passwordHash: "x" },
  });
  await prisma.order.create({
    data: {
      userId: cancelled.id,
      basketId,
      basketTierId: basket.tiers[1].id,
      deliveryWindowId: windowId,
      status: "cancelled",
      debitDate: win.cutoffAt,
      cancellationDeadline: win.cutoffAt,
      totalPence: 4000,
      deliveryAddress: "1 Test Street, Leeds",
    },
  });
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

describe("formatKg", () => {
  it("renders grams as kilograms to one decimal place", () => {
    expect(formatKg(22000)).toBe("22 kg");
    expect(formatKg(12500)).toBe("12.5 kg");
    expect(formatKg(0)).toBe("0 kg");
  });
});

describe("listAdminBaskets", () => {
  it("returns the basket with its city, food, tier count and joiners", async () => {
    const rows = await listAdminBaskets();
    const row = rows.find((r) => r.id === basketId);
    expect(row).toBeDefined();
    expect(row!.city).toBe(`${TAG} Leeds`);
    expect(row!.productName).toBe(`${TAG} Yam`);
    expect(row!.skuLabel).toBe("25 kg crate");
    expect(row!.tierCount).toBe(2);
    expect(row!.status).toBe("open");
    // 3 counted joiners; the cancelled order is excluded.
    expect(row!.joinersThisCycle).toBe(3);
  });

  it("includes a paused basket — the admin must still see it", async () => {
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    const rows = await listAdminBaskets();
    expect(rows.find((r) => r.id === basketId)!.status).toBe("paused");
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });
});

describe("listUpcomingCycles", () => {
  it("reports demand and how many bulk units to buy", async () => {
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    const row = rows.find((r) => r.basketId === basketId);
    expect(row).toBeDefined();
    expect(row!.grams).toBe(22000);
    expect(row!.joiners).toBe(3);
    expect(row!.bulkWeightGrams).toBe(25000);
    // 22 kg of demand against a 25 kg crate is still one crate.
    expect(row!.bulkUnitsNeeded).toBe(1);
    expect(row!.city).toBe(`${TAG} Leeds`);
    expect(row!.windowStatus).toBe("open");
  });

  it("rounds bulk units UP — a part unit is still a whole purchase", async () => {
    const tier = await prisma.basketTier.findFirstOrThrow({
      where: { basketId, label: "Large (10 kg)" },
    });
    const u = await prisma.user.create({
      data: { email: `${TAG}-extra@test`, name: "Extra", passwordHash: "x" },
    });
    await prisma.order.create({
      data: {
        userId: u.id,
        basketId,
        basketTierId: tier.id,
        deliveryWindowId: windowId,
        status: "committed",
        debitDate: new Date("2026-12-15T08:00:00Z"),
        cancellationDeadline: new Date("2026-12-15T08:00:00Z"),
        totalPence: 4000,
        deliveryAddress: "1 Test Street, Leeds",
      },
    });

    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    const row = rows.find((r) => r.basketId === basketId)!;
    expect(row.grams).toBe(32000); // 22 + 10
    expect(row.bulkUnitsNeeded).toBe(2); // 32 kg needs two 25 kg crates
  });

  it("counts hours to cutoff, going negative once it has passed", async () => {
    const before = await listUpcomingCycles(new Date("2026-12-14T08:00:00Z"));
    expect(before.find((r) => r.basketId === basketId)!.hoursToCutoff).toBe(24);

    const after = await listUpcomingCycles(new Date("2026-12-16T08:00:00Z"));
    expect(after.find((r) => r.basketId === basketId)!.hoursToCutoff).toBe(-24);
  });

  it("omits a window nobody has joined", async () => {
    const empty = await prisma.deliveryWindow.create({
      data: {
        cityId,
        deliveryDate: new Date("2027-01-02T00:00:00Z"),
        cutoffAt: cutoffAtFor(new Date("2027-01-02T00:00:00Z"), 4),
      },
    });
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    expect(rows.find((r) => r.windowId === empty.id)).toBeUndefined();
  });

  it("omits a window already dispatched", async () => {
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "dispatched" } });
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    expect(rows.find((r) => r.windowId === windowId)).toBeUndefined();
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "open" } });
  });
});

describe("listWindowOrders", () => {
  it("lists every order including cancelled ones, with who placed it", async () => {
    const rows = await listWindowOrders(windowId);
    // 3 counted + 1 cancelled + 1 added by the rounding test.
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.status === "cancelled")).toBe(true);
    expect(rows.every((r) => r.userEmail.startsWith(TAG))).toBe(true);
  });

  it("marks only a paid order refundable", async () => {
    const rows = await listWindowOrders(windowId);
    const paid = rows.find((r) => r.id === paidOrderId)!;
    expect(paid.canRefund).toBe(true);
    expect(rows.filter((r) => r.canRefund)).toHaveLength(1);
  });
});
