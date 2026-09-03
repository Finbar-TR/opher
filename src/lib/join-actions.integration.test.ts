import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_JOINACT_" + Date.now();
let userId = "";
let basketId = "";
let tierId = "";
let cityId = "";

// The server actions read the session. Mock auth to return our test user.
// A full mock, not `vi.importActual` — the real module imports `cookies`
// from `next/headers` at module scope, which is unsafe outside a request.
// Nothing else from the real module is needed here.
vi.mock("./auth", () => ({
  requireUser: async () => ({
    id: userId,
    email: `${TAG}-mem@test`,
    name: "Mem",
    role: "member" as const,
  }),
}));

beforeAll(async () => {
  const city = await prisma.city.create({
    data: { name: `${TAG} Bristol`, slug: `${TAG}-bristol`.toLowerCase(), anchorDate: new Date("2026-09-05T00:00:00Z") },
  });
  cityId = city.id;
  const product = await prisma.product.create({ data: { name: `${TAG} Egusi` } });
  const sku = await prisma.sku.create({
    data: { productId: product.id, label: "Egusi", weightGrams: 10000, wholesaleCostPence: 5500, purchaseThresholdGrams: 1 },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId, skuId: sku.id, label: `${TAG} Egusi — Bristol`, createdById: admin.id,
      tiers: { create: [{ label: "Medium (5 kg)", weightGrams: 5000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  basketId = basket.id;
  tierId = basket.tiers[0].id;

  const deliveryDate = new Date("2026-12-19T00:00:00Z");
  await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 3) },
  });

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

// The brief's own literal omitted `addrLine2`, but `AddressInput` (per the
// task interface) declares it a required, possibly-empty string — not
// optional — so the object must include it to satisfy that type.
const address = {
  addrLine1: "12 Test Road",
  addrLine2: "",
  addrCity: "Bristol",
  postcode: "BS1 1AA",
  phone: "07700 900111",
};

describe("startJoin", () => {
  it("returns a dev payment method when Stripe is unconfigured", async () => {
    const { startJoin } = await import("../app/baskets/[id]/join/actions");
    const res = await startJoin(basketId);
    expect(res.clientSecret).toBeNull();
    expect(res.setupIntentId).toMatch(/^dev_seti_/);
    expect(res.devPaymentMethodId).toMatch(/^dev_pm_/);
  });

  it("persists a Stripe customer id on the user", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.stripeCustomerId).toMatch(/^dev_cus_/);
  });
});

describe("completeJoin", () => {
  it("saves the address and creates a committed order", async () => {
    const { startJoin, completeJoin } = await import("../app/baskets/[id]/join/actions");
    const started = await startJoin(basketId);

    const { orderId } = await completeJoin({
      basketId,
      tierId,
      setupIntentId: started.setupIntentId,
      paymentMethodId: started.devPaymentMethodId!,
      address,
      utm: { source: "meta", campaign: "egusi-bristol" },
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("committed");
    expect(order.totalPence).toBe(2200);
    expect(order.deliveryAddress).toContain("12 Test Road");
    expect(order.utmSource).toBe("meta");

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.postcode).toBe("BS1 1AA");
  });

  it("refuses an incomplete address", async () => {
    const { startJoin, completeJoin } = await import("../app/baskets/[id]/join/actions");
    const started = await startJoin(basketId);
    await expect(
      completeJoin({
        basketId,
        tierId,
        setupIntentId: started.setupIntentId,
        paymentMethodId: started.devPaymentMethodId!,
        address: { ...address, postcode: "" },
      })
    ).rejects.toThrow(/postcode/i);
  });

  it("refuses a tier from a different basket", async () => {
    const { startJoin, completeJoin } = await import("../app/baskets/[id]/join/actions");
    const started = await startJoin(basketId);
    await expect(
      completeJoin({
        basketId,
        tierId: "not-a-real-tier",
        setupIntentId: started.setupIntentId,
        paymentMethodId: started.devPaymentMethodId!,
        address,
      })
    ).rejects.toThrow();
  });
});
