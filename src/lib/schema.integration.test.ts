import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { CUTOFF_HOUR_UTC } from "./constants";

// Proves the new model graph can be created end to end: a city with a delivery
// window, a product/SKU, an admin-owned basket with a tier, and one order
// joining that tier for that window.

const TAG = "ZZTEST_SCHEMA_" + Date.now();
let cityId = "";

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.demandSnapshot.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("schema", () => {
  it("creates a city, basket, tier, window and order", async () => {
    const city = await prisma.city.create({
      data: {
        name: `${TAG} Sheffield`,
        slug: `${TAG}-sheffield`.toLowerCase(),
        anchorDate: new Date("2026-09-05T00:00:00Z"),
      },
    });
    cityId = city.id;
    expect(city.cadenceDays).toBe(14);
    expect(city.cutoffDays).toBe(3);

    const product = await prisma.product.create({
      data: { name: `${TAG} White Yam`, category: "dry" },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        label: "White Yam",
        weightGrams: 25000,
        wholesaleCostPence: 4000,
        purchaseThresholdGrams: 100000,
        leadTimeDays: 2,
      },
    });

    const admin = await prisma.user.create({
      data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
    });

    const basket = await prisma.basket.create({
      data: {
        cityId: city.id,
        skuId: sku.id,
        label: `${TAG} Yam — Sheffield`,
        createdById: admin.id,
        tiers: {
          create: [
            { label: "Small (2 kg)", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
            { label: "Medium (5 kg)", weightGrams: 5000, pricePence: 2200, displayOrder: 2 },
          ],
        },
      },
      include: { tiers: true },
    });
    expect(basket.status).toBe("open");
    expect(basket.tiers).toHaveLength(2);

    const cutoffAt = new Date("2026-09-16T08:00:00Z");
    const window = await prisma.deliveryWindow.create({
      data: { cityId: city.id, deliveryDate: new Date("2026-09-19T00:00:00Z"), cutoffAt },
    });
    expect(window.status).toBe("open");
    expect(cutoffAt.getUTCHours()).toBe(CUTOFF_HOUR_UTC);

    const member = await prisma.user.create({
      data: { email: `${TAG}-mem@test`, name: "Mem", passwordHash: "x" },
    });
    const order = await prisma.order.create({
      data: {
        userId: member.id,
        basketId: basket.id,
        basketTierId: basket.tiers[1].id,
        deliveryWindowId: window.id,
        debitDate: cutoffAt,
        cancellationDeadline: cutoffAt,
        totalPence: 2200,
        deliveryAddress: "1 Test Street, Sheffield S1 1AA",
      },
    });
    expect(order.status).toBe("committed");
    expect(order.paymentRetryCount).toBe(0);
  });

  it("refuses a second order for the same user, basket and window", async () => {
    const basket = await prisma.basket.findFirstOrThrow({ where: { cityId } , include: { tiers: true }});
    const window = await prisma.deliveryWindow.findFirstOrThrow({ where: { cityId } });
    const member = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: TAG }, role: "member" } });

    await expect(
      prisma.order.create({
        data: {
          userId: member.id,
          basketId: basket.id,
          basketTierId: basket.tiers[0].id,
          deliveryWindowId: window.id,
          debitDate: window.cutoffAt,
          cancellationDeadline: window.cutoffAt,
          totalPence: 950,
          deliveryAddress: "1 Test Street",
        },
      })
    ).rejects.toThrow();
  });
});
