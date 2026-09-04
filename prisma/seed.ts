import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES, DEFAULT_CADENCE_DAYS, DEFAULT_CUTOFF_DAYS } from "../src/lib/constants";
import { cutoffAtFor, upcomingDeliveryDates } from "../src/lib/cycles";

const prisma = new PrismaClient();

// Anchor the delivery series on the next Saturday, staggering each city by a
// day so the eight runs don't all land together.
function anchorFor(index: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + index);
  return d;
}

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "operator@opher.test" },
    update: { role: "operator" },
    create: { email: "operator@opher.test", name: "Ops Team", passwordHash, role: "operator" },
  });
  await prisma.user.upsert({
    where: { email: "aisha@opher.test" },
    update: {},
    create: { email: "aisha@opher.test", name: "Aisha", passwordHash },
  });
  await prisma.user.upsert({
    where: { email: "ben@opher.test" },
    update: {},
    create: { email: "ben@opher.test", name: "Ben", passwordHash },
  });

  // The eight cities, each on a fortnightly schedule with the default 3-day
  // cutoff. Set explicitly rather than left to the column defaults, so the
  // series here always matches what `cutoffAtFor`/`upcomingDeliveryDates`
  // below are computed against, even if the schema defaults ever drift.
  for (const [i, name] of CITIES.entries()) {
    const slug = name.toLowerCase();
    await prisma.city.upsert({
      where: { slug },
      update: {},
      create: {
        name,
        slug,
        anchorDate: anchorFor(i),
        cadenceDays: DEFAULT_CADENCE_DAYS,
        cutoffDays: DEFAULT_CUTOFF_DAYS,
      },
    });
  }

  // Launch catalogue: dry goods only, bought by hand at launch — nothing here
  // writes a PurchaseOrder or varies supply. `purchaseThresholdGrams` has no
  // schema default and is otherwise unused now that there is no minimum-demand
  // decision, so every SKU gets the same placeholder value.
  const catalogue = [
    {
      name: "White Yam",
      description: "Ambient-stable white yam, bought by the 25 kg crate.",
      weightGrams: 25000,
      wholesaleCostPence: 4200,
    },
    {
      name: "Egusi",
      description: "Ground melon seed, by the 10 kg sack.",
      weightGrams: 10000,
      wholesaleCostPence: 5500,
    },
    {
      name: "Crayfish",
      description: "Dried ground crayfish, by the 5 kg box.",
      weightGrams: 5000,
      wholesaleCostPence: 6800,
    },
  ];

  const skus: Record<string, string> = {};
  for (const item of catalogue) {
    const existing = await prisma.product.findFirst({ where: { name: item.name } });
    const product =
      existing ??
      (await prisma.product.create({
        data: { name: item.name, description: item.description, category: "dry" },
      }));

    const existingSku = await prisma.sku.findFirst({ where: { productId: product.id } });
    const sku =
      existingSku ??
      (await prisma.sku.create({
        data: {
          productId: product.id,
          label: item.name,
          weightGrams: item.weightGrams,
          wholesaleCostPence: item.wholesaleCostPence,
          purchaseThresholdGrams: 1, // unused placeholder — supply is bought by hand
        },
      }));
    skus[item.name] = sku.id;
  }

  // The four-tier price ladder: bigger tiers are cheaper per kg.
  const TIERS = [
    { label: "Small (2 kg)", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
    { label: "Medium (5 kg)", weightGrams: 5000, pricePence: 2200, displayOrder: 2 },
    { label: "Large (10 kg)", weightGrams: 10000, pricePence: 4000, displayOrder: 3 },
    { label: "Family (20 kg)", weightGrams: 20000, pricePence: 7200, displayOrder: 4 },
  ];

  // Yam appears in two cities so the city-isolation rule is visible side by
  // side: each basket's demand and window are entirely its own.
  const baskets = [
    { city: "Sheffield", product: "White Yam" },
    { city: "Birmingham", product: "White Yam" },
    { city: "Manchester", product: "Egusi" },
    { city: "London", product: "Crayfish" },
  ];

  for (const b of baskets) {
    const city = await prisma.city.findUniqueOrThrow({ where: { slug: b.city.toLowerCase() } });
    const skuId = skus[b.product];

    const existing = await prisma.basket.findFirst({
      where: { cityId: city.id, skuId, status: { not: "archived" } },
    });
    if (existing) continue;

    await prisma.basket.create({
      data: {
        cityId: city.id,
        skuId,
        label: `${b.product} — ${b.city}`,
        createdById: admin.id,
        tiers: { create: TIERS },
      },
    });
  }

  // Two open windows per city, matching what the cron maintains.
  const now = new Date();
  for (const city of await prisma.city.findMany({ where: { active: true } })) {
    for (const deliveryDate of upcomingDeliveryDates(city.anchorDate, city.cadenceDays, now, 2)) {
      const cutoffAt = cutoffAtFor(deliveryDate, city.cutoffDays);
      await prisma.deliveryWindow.upsert({
        where: { cityId_deliveryDate: { cityId: city.id, deliveryDate } },
        update: {},
        create: {
          cityId: city.id,
          deliveryDate,
          cutoffAt,
          status: cutoffAt <= now ? "locked" : "open",
        },
      });
    }
  }

  console.log("Seeded 8 cities, 3 products, 4 baskets and their delivery windows.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
