// Deletes every basket, its sizes, and the orders attached to them.
//
// Leaves alone: cities, delivery windows, the catalogue of foods, and user
// accounts. Only the sellable offers and what people ordered from them go.
//
// PREVIEWS BY DEFAULT. Nothing is deleted unless WIPE_APPLY=1.
//
// Refuses outright if any order has money attached to it - a `paid` order, or
// one carrying a Stripe payment intent. Deleting those would destroy the only
// record of a real charge, and a customer would have been charged for a
// delivery no longer in the system. Clearing test data must never be able to
// do that by accident, so the check is not optional and has no override.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apply = process.env.WIPE_APPLY === "1";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const baskets = await prisma.basket.findMany({
    include: {
      city: { select: { name: true } },
      sku: { select: { label: true, product: { select: { name: true } } } },
      tiers: { select: { id: true } },
      orders: {
        select: { id: true, status: true, totalPence: true, stripePaymentIntentId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (baskets.length === 0) {
    console.log("\nNo baskets. Nothing to do.");
    return;
  }

  const allOrders = baskets.flatMap((b) => b.orders);

  console.log(`\n${baskets.length} basket${baskets.length === 1 ? "" : "s"} to delete:`);
  for (const b of baskets) {
    const money = b.orders.filter((o) => o.status === "paid" || o.stripePaymentIntentId).length;
    console.log(
      `  ${b.label}  [${b.city.name} / ${b.sku.product.name}]  ` +
        `${b.tiers.length} size(s), ${b.orders.length} order(s)` +
        (money ? `  <-- ${money} WITH MONEY ATTACHED` : "")
    );
  }

  // --- The safety check ------------------------------------------------------
  const withMoney = allOrders.filter((o) => o.status === "paid" || o.stripePaymentIntentId !== null);

  if (withMoney.length) {
    console.log(`\nREFUSING TO DELETE.`);
    console.log(`${withMoney.length} order${withMoney.length === 1 ? " has" : "s have"} money attached:`);
    for (const o of withMoney.slice(0, 10)) {
      console.log(
        `  order ${o.id}  status=${o.status}  £${(o.totalPence / 100).toFixed(2)}` +
          (o.stripePaymentIntentId ? `  intent=${o.stripePaymentIntentId}` : "")
      );
    }
    if (withMoney.length > 10) console.log(`  ...and ${withMoney.length - 10} more.`);
    console.log(
      `\nDeleting these would destroy the only record of a real charge.\n` +
        `Refund them through /operator/cycles first, then run this again.`
    );
    process.exitCode = 1;
    return;
  }

  const statuses = new Map<string, number>();
  for (const o of allOrders) statuses.set(o.status, (statuses.get(o.status) ?? 0) + 1);

  console.log(`\nAlso deleting ${allOrders.length} order${allOrders.length === 1 ? "" : "s"}` +
    (statuses.size ? ` (${[...statuses].map(([s, n]) => `${n} ${s}`).join(", ")})` : "") + ".");
  console.log("No order has money attached, so nothing owed to anyone is lost.");
  console.log("\nKeeping: cities, delivery dates, the food catalogue, and all accounts.");

  if (!apply) {
    console.log("\nPREVIEW ONLY - nothing was deleted.");
    console.log("Re-run with -Apply to delete.");
    return;
  }

  const basketIds = baskets.map((b) => b.id);

  // Children first: orders reference both basket and tier.
  const orders = await prisma.order.deleteMany({ where: { basketId: { in: basketIds } } });
  const snapshots = await prisma.demandSnapshot.deleteMany({ where: { basketId: { in: basketIds } } });
  const tiers = await prisma.basketTier.deleteMany({ where: { basketId: { in: basketIds } } });
  const gone = await prisma.basket.deleteMany({ where: { id: { in: basketIds } } });

  console.log(
    `\nDeleted ${gone.count} basket(s), ${tiers.count} size(s), ${orders.count} order(s)` +
      `, ${snapshots.count} demand snapshot(s).`
  );
  console.log("Clean slate. Cities, catalogue and accounts are untouched.");
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
