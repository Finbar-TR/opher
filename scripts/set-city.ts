// Sets a city's launch date, or switches a city on and off.
//
// The design deliberately gives baskets no dates of their own: a basket is a
// standing offer, and the city owns the calendar. So "when does Sheffield start
// selling" is a property of Sheffield, set here.
//
// Switching a city OFF hides it completely - it disappears from the customer
// city list, its baskets stop being listed (basket-views.ts), and the daily job
// stops generating deliveries for it (windows.ts). That is how you hold seven
// cities back while you run one.
//
// PREVIEWS BY DEFAULT. Nothing is written unless CITY_APPLY=1.
//
// Usage (via the wrapper):
//   .\scripts\set-city.ps1 -City Sheffield -Start 2026-09-19 -On
//   .\scripts\set-city.ps1 -City London -Off

import { PrismaClient } from "@prisma/client";
import { OPEN_WINDOWS_AHEAD } from "../src/lib/constants";
import { cutoffAtFor, upcomingDeliveryDates } from "../src/lib/cycles";

const prisma = new PrismaClient();

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtFull(d: Date): string {
  return d.toUTCString().replace(":00 GMT", " UTC").replace(/^\w+, /, "");
}

async function main() {
  const names = (process.env.CITY_NAMES ?? "")
    .split("|")
    .map((n) => n.trim())
    .filter(Boolean);
  const startRaw = (process.env.CITY_START ?? "").trim();
  const apply = process.env.CITY_APPLY === "1";

  if (!names.length) throw new Error("CITY_NAMES is not set. Run this through scripts/set-city.ps1.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  // A start date only makes sense for one city at a time - seven cities cannot
  // share a first delivery date without stacking every run on the same day.
  if (startRaw && names.length > 1) {
    throw new Error(
      `A start date can only be set for one city at a time.\n` +
        `You gave ${names.length}: ${names.join(", ")}.`
    );
  }

  for (const name of names) {
    await applyToCity(name, startRaw, apply);
  }

  if (!apply) {
    console.log("\nPREVIEW ONLY - nothing was written.");
    console.log("Re-run with -Apply to make the change.");
  }
}

async function applyToCity(name: string, startRaw: string, apply: boolean) {
  const onOff = (process.env.CITY_ONOFF ?? "").trim(); // "on" | "off" | ""

  const city = await prisma.city.findFirst({
    where: { name: { equals: name } },
    include: { windows: { orderBy: { deliveryDate: "asc" } } },
  });

  if (!city) {
    const all = await prisma.city.findMany({ select: { name: true }, orderBy: { name: "asc" } });
    throw new Error(`No city called "${name}".\nCities on this database: ${all.map((c) => c.name).join(", ")}`);
  }

  // --- Work out the new settings -------------------------------------------
  let anchorDate = city.anchorDate;
  if (startRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
      throw new Error(`Start date must look like 2026-09-19. Got "${startRaw}".`);
    }
    const parsed = new Date(`${startRaw}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error(`"${startRaw}" is not a real date.`);
    anchorDate = parsed;
  }

  const active = onOff === "on" ? true : onOff === "off" ? false : city.active;

  console.log(`\n${city.name}`);
  console.log(`  Currently:  ${city.active ? "ON" : "OFF"}, first delivery ${fmt(city.anchorDate)}, every ${city.cadenceDays} days, closing ${city.cutoffDays} days before`);
  console.log(`  Will be:    ${active ? "ON" : "OFF"}, first delivery ${fmt(anchorDate)}, every ${city.cadenceDays} days, closing ${city.cutoffDays} days before`);

  // --- Which existing windows are in the way? ------------------------------
  // A window with orders in it is never touched: those customers are owed the
  // delivery they joined for. Only empty future windows are regenerated.
  const now = new Date();
  const orderCounts = new Map<string, number>();
  for (const w of city.windows) {
    orderCounts.set(w.id, await prisma.order.count({ where: { deliveryWindowId: w.id } }));
  }

  const wanted = upcomingDeliveryDates(anchorDate, city.cadenceDays, now, OPEN_WINDOWS_AHEAD);
  const wantedKeys = new Set(wanted.map((d) => d.getTime()));

  const stale = city.windows.filter(
    (w) => w.deliveryDate > now && !wantedKeys.has(w.deliveryDate.getTime()) && (orderCounts.get(w.id) ?? 0) === 0
  );
  const protectedWindows = city.windows.filter(
    (w) => w.deliveryDate > now && !wantedKeys.has(w.deliveryDate.getTime()) && (orderCounts.get(w.id) ?? 0) > 0
  );
  const toCreate = wanted.filter(
    (d) => !city.windows.some((w) => w.deliveryDate.getTime() === d.getTime())
  );

  console.log("\n  Deliveries after this change:");
  for (const d of wanted) {
    const cut = cutoffAtFor(d, city.cutoffDays);
    console.log(`    ${fmt(d)}  (orders close ${fmtFull(cut)})`);
  }

  if (stale.length) {
    console.log(`\n  ${stale.length} empty future delivery/deliveries will be removed:`);
    for (const w of stale) console.log(`    ${fmt(w.deliveryDate)}`);
  }
  if (protectedWindows.length) {
    console.log(`\n  KEPT - these have orders in them and will not be moved:`);
    for (const w of protectedWindows) {
      console.log(`    ${fmt(w.deliveryDate)} (${orderCounts.get(w.id)} order(s))`);
    }
  }
  if (!active) {
    console.log("\n  While OFF: hidden from the customer city list, its baskets are not");
    console.log("  listed, and the daily job creates no new deliveries for it.");
  }

  if (!apply) return;

  // --- Write ---------------------------------------------------------------
  await prisma.city.update({ where: { id: city.id }, data: { anchorDate, active } });

  if (stale.length) {
    await prisma.deliveryWindow.deleteMany({ where: { id: { in: stale.map((w) => w.id) } } });
  }

  let created = 0;
  for (const deliveryDate of toCreate) {
    const cutoffAt = cutoffAtFor(deliveryDate, city.cutoffDays);
    await prisma.deliveryWindow.create({
      data: {
        cityId: city.id,
        deliveryDate,
        cutoffAt,
        status: cutoffAt <= now ? "locked" : "open",
      },
    });
    created++;
  }

  console.log(`\nDone. ${city.name} is ${active ? "ON" : "OFF"}, first delivery ${fmt(anchorDate)}.`);
  console.log(`Removed ${stale.length} empty delivery/deliveries, created ${created}.`);
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
