import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { cutoffAtFor } from "../src/lib/cycles";

const prisma = new PrismaClient();

// Adds joined orders on top of `npm run db:seed` so the states Plan 2's
// screens need to render are all reachable by hand:
//
//   - a basket with several joiners
//   - a basket with a single joiner
//   - a basket whose window is close to its own cutoff
//   - a basket with a mix of order statuses (committed / paid / cancelled),
//     so the my-orders screen has something real to show
//
// Nothing here writes a PurchaseOrder or varies supply — supply is bought by
// hand, not decided by this script.
async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const baskets = await prisma.basket.findMany({
    include: { tiers: { orderBy: { displayOrder: "asc" } }, city: true, sku: true },
    orderBy: { createdAt: "asc" },
  });
  if (baskets.length < 4) {
    throw new Error("Run `npm run db:seed` first — expected at least 4 baskets.");
  }

  async function member(tag: string) {
    const email = `scenario-${tag}@opher.test`;
    return prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: `Scenario ${tag}`,
        passwordHash,
        addrLine1: "1 Scenario Street",
        addrCity: "Sheffield",
        postcode: "S1 1AA",
      },
    });
  }

  async function earliestOpenWindow(cityId: string) {
    return prisma.deliveryWindow.findFirst({
      where: { cityId, status: "open" },
      orderBy: { deliveryDate: "asc" },
    });
  }

  async function join(params: {
    basketIndex: number;
    tierIndex: number;
    tag: string;
    status: string;
    windowId: string;
    stripePaymentIntentId?: string;
    stripePaymentMethodId?: string | null;
  }) {
    const basket = baskets[params.basketIndex];
    const window = await prisma.deliveryWindow.findUniqueOrThrow({
      where: { id: params.windowId },
    });
    const user = await member(`${params.tag}-${params.basketIndex}`);
    const tier = basket.tiers[params.tierIndex];

    await prisma.order.upsert({
      where: {
        userId_basketId_deliveryWindowId: {
          userId: user.id,
          basketId: basket.id,
          deliveryWindowId: window.id,
        },
      },
      update: { status: params.status },
      create: {
        userId: user.id,
        basketId: basket.id,
        basketTierId: tier.id,
        deliveryWindowId: window.id,
        status: params.status,
        stripeCustomerId: "dev_cus_scenario",
        stripePaymentMethodId:
          params.stripePaymentMethodId === undefined
            ? "dev_pm_scenario"
            : params.stripePaymentMethodId,
        stripePaymentIntentId: params.stripePaymentIntentId,
        debitDate: window.cutoffAt,
        cancellationDeadline: window.cutoffAt,
        totalPence: tier.pricePence,
        deliveryAddress: "1 Scenario Street, Sheffield S1 1AA",
      },
    });
  }

  // Basket 0 (Yam Sheffield): several joiners, spread across tiers.
  const window0 = await earliestOpenWindow(baskets[0].cityId);
  if (window0) {
    let i = 0;
    for (const tag of ["a", "b", "c", "d"]) {
      await join({ basketIndex: 0, tierIndex: i % 4, tag, status: "committed", windowId: window0.id });
      i++;
    }
  }

  // Basket 1 (Yam Birmingham): a single joiner. Same food as basket 0, a
  // different city, so the isolation rule is visible side by side.
  const window1 = await earliestOpenWindow(baskets[1].cityId);
  if (window1) {
    await join({ basketIndex: 1, tierIndex: 0, tag: "a", status: "committed", windowId: window1.id });
  }

  // Basket 2 (Egusi Manchester): a window close to its own cutoff, so the
  // "closes soon" state is visible without waiting for the calendar. Pulling
  // the cutoff forward like this only makes sense on a window still `open` —
  // moving a `locked` one would misrepresent what the cron already decided.
  const window2 = await earliestOpenWindow(baskets[2].cityId);
  if (window2) {
    await prisma.deliveryWindow.update({
      where: { id: window2.id },
      data: { cutoffAt: new Date(Date.now() + 18 * 60 * 60 * 1000) },
    });
    for (const tag of ["a", "b"]) {
      await join({ basketIndex: 2, tierIndex: 2, tag, status: "committed", windowId: window2.id });
    }
  }

  // Basket 3 (Crayfish London): a mix of order statuses. A committed and a
  // cancelled order share the current open window; a paid order sits in a
  // past, already-dispatched window, standing in for a delivery that has
  // already happened.
  const basket3 = baskets[3];
  const pastDeliveryDate = new Date("2026-01-01T00:00:00Z");
  const pastWindow = await prisma.deliveryWindow.upsert({
    where: { cityId_deliveryDate: { cityId: basket3.cityId, deliveryDate: pastDeliveryDate } },
    update: {},
    create: {
      cityId: basket3.cityId,
      deliveryDate: pastDeliveryDate,
      cutoffAt: cutoffAtFor(pastDeliveryDate, basket3.city.cutoffDays),
      status: "dispatched",
    },
  });
  await join({
    basketIndex: 3,
    tierIndex: 1,
    tag: "paid",
    status: "paid",
    windowId: pastWindow.id,
    stripePaymentIntentId: "dev_pi_scenario_paid",
  });

  const window3 = await earliestOpenWindow(basket3.cityId);
  if (window3) {
    await join({ basketIndex: 3, tierIndex: 0, tag: "committed", status: "committed", windowId: window3.id });
    await join({
      basketIndex: 3,
      tierIndex: 0,
      tag: "cancelled",
      status: "cancelled",
      windowId: window3.id,
      stripePaymentMethodId: null,
    });
  }

  console.log("Scenario seeded: several joiners, a single joiner, a window closing soon, and a mix of order statuses.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
