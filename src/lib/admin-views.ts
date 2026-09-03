import "server-only";
import { prisma } from "./prisma";
import { DEMAND_COUNTED_STATUSES } from "./constants";

// Read models for the operator screens. The customer-facing equivalents live in
// `basket-views.ts`; these are separate because the operator needs things a
// customer must never see — who joined, what is still unpaid, and what to buy.

export type AdminBasketRow = {
  id: string;
  label: string;
  city: string;
  productName: string;
  skuLabel: string;
  status: string;
  tierCount: number;
  joinersThisCycle: number;
};

export type CycleRow = {
  windowId: string;
  basketId: string;
  city: string;
  productName: string;
  skuLabel: string;
  deliveryDate: Date;
  cutoffAt: Date;
  windowStatus: string;
  hoursToCutoff: number;
  joiners: number;
  grams: number;
  bulkWeightGrams: number;
  bulkUnitsNeeded: number;
};

export type WindowOrderRow = {
  id: string;
  userName: string;
  userEmail: string;
  tierLabel: string;
  status: string;
  totalPence: number;
  canRefund: boolean;
};

// Whole hours from `now` to `cutoffAt`, negative once the cutoff has passed.
// The operator's whole job on cutoff day is knowing how long is left, so this
// is deliberately signed rather than clamped at zero.
function hoursUntil(cutoffAt: Date, now: Date): number {
  return Math.round((cutoffAt.getTime() - now.getTime()) / (60 * 60 * 1000));
}

export async function listAdminBaskets(): Promise<AdminBasketRow[]> {
  const baskets = await prisma.basket.findMany({
    where: { status: { not: "archived" } },
    include: {
      city: { include: { windows: { where: { status: "open" }, orderBy: { deliveryDate: "asc" }, take: 1 } } },
      sku: { include: { product: true } },
      tiers: { where: { active: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: AdminBasketRow[] = [];

  for (const b of baskets) {
    const window = b.city.windows[0];
    const joiners = window
      ? await prisma.order.count({
          where: {
            basketId: b.id,
            deliveryWindowId: window.id,
            status: { in: DEMAND_COUNTED_STATUSES },
          },
        })
      : 0;

    rows.push({
      id: b.id,
      label: b.label,
      city: b.city.name,
      productName: b.sku.product.name,
      skuLabel: b.sku.label,
      status: b.status,
      tierCount: b.tiers.length,
      joinersThisCycle: joiners,
    });
  }

  return rows;
}

// The what-to-buy readout. Covers windows that are still `open` as well as
// `locked` ones: a thin window has to be visible BEFORE its cutoff day, because
// once the cutoff passes the cards are charged and the delivery is committed.
//
// A window nobody has joined is omitted — there is nothing to buy for it.
export async function listUpcomingCycles(now: Date = new Date()): Promise<CycleRow[]> {
  const windows = await prisma.deliveryWindow.findMany({
    where: { status: { in: ["open", "locked"] } },
    include: { city: true },
    orderBy: { deliveryDate: "asc" },
  });

  const rows: CycleRow[] = [];

  for (const window of windows) {
    const orders = await prisma.order.findMany({
      where: {
        deliveryWindowId: window.id,
        status: { in: DEMAND_COUNTED_STATUSES },
      },
      select: {
        basketId: true,
        tier: { select: { weightGrams: true } },
        basket: { include: { sku: { include: { product: true } } } },
      },
    });

    // Group by basket: one delivery run carries several foods, but each food is
    // bought separately.
    const byBasket = new Map<string, typeof orders>();
    for (const o of orders) {
      const list = byBasket.get(o.basketId) ?? [];
      list.push(o);
      byBasket.set(o.basketId, list);
    }

    for (const [basketId, basketOrders] of byBasket) {
      const grams = basketOrders.reduce((sum, o) => sum + o.tier.weightGrams, 0);
      const sku = basketOrders[0].basket.sku;
      // Round UP: a part unit is still a whole purchase from the supplier.
      const bulkUnitsNeeded =
        sku.weightGrams > 0 ? Math.ceil(grams / sku.weightGrams) : 0;

      rows.push({
        windowId: window.id,
        basketId,
        city: window.city.name,
        productName: sku.product.name,
        skuLabel: sku.label,
        deliveryDate: window.deliveryDate,
        cutoffAt: window.cutoffAt,
        windowStatus: window.status,
        hoursToCutoff: hoursUntil(window.cutoffAt, now),
        joiners: basketOrders.length,
        grams,
        bulkWeightGrams: sku.weightGrams,
        bulkUnitsNeeded,
      });
    }
  }

  return rows;
}

// Every order in a window, cancelled ones included — the operator is reconciling
// a delivery, so they need the whole picture, not just what still counts.
export async function listWindowOrders(windowId: string): Promise<WindowOrderRow[]> {
  const orders = await prisma.order.findMany({
    where: { deliveryWindowId: windowId },
    include: {
      user: { select: { name: true, email: true } },
      tier: { select: { label: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return orders.map((o) => ({
    id: o.id,
    userName: o.user.name,
    userEmail: o.user.email,
    tierLabel: o.tier.label,
    status: o.status,
    totalPence: o.totalPence,
    // Mirrors `refundOrder`'s own guard in refunds.ts: only a charged order can
    // be refunded. The button must never promise what the action refuses.
    canRefund: o.status === "paid" && o.stripePaymentIntentId !== null,
  }));
}
