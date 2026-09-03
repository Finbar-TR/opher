import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

const TAG = "ZZTEST_RESTORE_" + Date.now();
let operatorId = "";
let cityId = "";

// setBasketStatusAction reads the session via requireOperator. Mock auth to
// return our test operator — a full mock, not `vi.importActual`, because the
// real module imports `cookies` from `next/headers` at module scope, which is
// unsafe outside a request. Nothing else from the real module is needed here.
vi.mock("@/lib/auth", () => ({
  requireOperator: async () => ({
    id: operatorId,
    email: `${TAG}-ops@test`,
    name: "Ops",
    role: "operator" as const,
  }),
}));

// The action revalidates paths on success, which needs a request-scoped
// static-generation store that does not exist outside `next dev`/`next start`.
// Not under test here — the guard and the write are.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} Bristol`,
      slug: `${TAG}-bristol`.toLowerCase(),
      anchorDate: new Date("2026-12-19T00:00:00Z"),
    },
  });
  cityId = city.id;

  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  operatorId = admin.id;
});

afterAll(async () => {
  await prisma.basketTier.deleteMany({ where: { basket: { cityId } } });
  await prisma.basket.deleteMany({ where: { cityId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

async function makeSku(label: string) {
  const product = await prisma.product.create({ data: { name: `${TAG} ${label}` } });
  return prisma.sku.create({
    data: {
      productId: product.id,
      label,
      weightGrams: 10000,
      wholesaleCostPence: 5500,
      purchaseThresholdGrams: 1,
    },
  });
}

async function makeBasket(skuId: string, label: string, status: string) {
  return prisma.basket.create({
    data: {
      cityId,
      skuId,
      label,
      status,
      createdById: operatorId,
      tiers: {
        create: [
          { label: "Small", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
          { label: "Large", weightGrams: 10000, pricePence: 4000, displayOrder: 2 },
        ],
      },
    },
  });
}

describe("setBasketStatusAction — restoring an archived basket", () => {
  it("refuses to restore when another live basket already holds the (city, sku) pair", async () => {
    const { setBasketStatusAction } = await import("./actions");
    const sku = await makeSku("Yam Restore Clash");

    // A was open, then archived — which is what freed the pair for B.
    const basketA = await makeBasket(sku.id, `${TAG} A`, "archived");
    const basketB = await makeBasket(sku.id, `${TAG} B`, "open");

    const form = new FormData();
    form.set("basketId", basketA.id);
    form.set("status", "open");

    await expect(setBasketStatusAction(form)).rejects.toThrow(basketB.label);

    const reread = await prisma.basket.findUniqueOrThrow({ where: { id: basketA.id } });
    expect(reread.status).toBe("archived");
  });

  it("restores an archived basket whose pair is still free", async () => {
    const { setBasketStatusAction } = await import("./actions");
    const sku = await makeSku("Yam Restore Free");

    const basket = await makeBasket(sku.id, `${TAG} Free`, "archived");

    const form = new FormData();
    form.set("basketId", basket.id);
    form.set("status", "open");

    await setBasketStatusAction(form);

    const reread = await prisma.basket.findUniqueOrThrow({ where: { id: basket.id } });
    expect(reread.status).toBe("open");
  });
});
