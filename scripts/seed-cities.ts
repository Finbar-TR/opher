// Production-safe setup: cities and their delivery windows, and nothing else.
//
// This exists because `prisma/seed.ts` is a DEVELOPMENT seed — it creates user
// accounts that all share the password "password123", which is printed in the
// public README. Running that against production would hand an admin login with
// refund powers to anyone who read the repo. This script creates no users, no
// products and no baskets: you build the catalogue through /operator/catalogue,
// and you make yourself an operator by hand.
//
// Safe to re-run: every write is an upsert that leaves existing rows alone.
//
// Usage (via the wrapper, which prompts for the connection string):
//   .\scripts\seed-cities.ps1

import { PrismaClient } from "@prisma/client";
import { CITIES, DEFAULT_CADENCE_DAYS, DEFAULT_CUTOFF_DAYS } from "../src/lib/constants";
import { cutoffAtFor, upcomingDeliveryDates } from "../src/lib/cycles";

const prisma = new PrismaClient();

// Anchor each city's fortnightly series on the next Saturday, staggering one
// city per day so all eight delivery runs don't land on the same date. Matches
// the development seed so the two behave alike.
function anchorFor(index: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + index);
  return d;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error("DATABASE_URL is not set. Run this through scripts/seed-cities.ps1.");
  }

  // Refuse to run against a local SQLite file. Seeding dev by accident is
  // harmless, but the confusion of thinking production is set up when it isn't
  // is exactly what costs an afternoon.
  if (url.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL points at a local SQLite file. This script is for production; " +
        "use `npm run db:seed` for local development."
    );
  }

  let created = 0;
  for (const [i, name] of CITIES.entries()) {
    const slug = name.toLowerCase();
    const before = await prisma.city.findUnique({ where: { slug } });
    await prisma.city.upsert({
      where: { slug },
      // Deliberately empty: re-running must never reset a schedule you have
      // since adjusted by hand.
      update: {},
      create: {
        name,
        slug,
        anchorDate: anchorFor(i),
        cadenceDays: DEFAULT_CADENCE_DAYS,
        cutoffDays: DEFAULT_CUTOFF_DAYS,
      },
    });
    if (!before) created++;
  }

  // Two open windows per city — the same number the daily cron maintains, so
  // customers can join straight away rather than waiting for 08:00 UTC.
  const now = new Date();
  let windows = 0;
  for (const city of await prisma.city.findMany({ where: { active: true } })) {
    for (const deliveryDate of upcomingDeliveryDates(city.anchorDate, city.cadenceDays, now, 2)) {
      const cutoffAt = cutoffAtFor(deliveryDate, city.cutoffDays);
      const existing = await prisma.deliveryWindow.findUnique({
        where: { cityId_deliveryDate: { cityId: city.id, deliveryDate } },
      });
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
      if (!existing) windows++;
    }
  }

  const totalCities = await prisma.city.count();
  console.log(
    `Cities: ${totalCities} present (${created} new). Delivery windows: ${windows} new.`
  );
  console.log("No users, products or baskets were created — that is deliberate.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
