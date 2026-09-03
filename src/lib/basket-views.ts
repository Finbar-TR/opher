import "server-only";
import { prisma } from "./prisma";
import { DEMAND_COUNTED_STATUSES } from "./constants";

// Read models for the customer-facing screens. Pages stay presentational and
// the queries are tested once, here.
//
// Everything time-related is derived from the basket's city — `cutoffDays` in
// particular is a per-city column, and copy that hardcodes "three days" is
// wrong for any city the operator has configured differently.

export type TierOption = {
  id: string;
  label: string;
  weightGrams: number;
  pricePence: number;
  pricePerKgPence: number;
};

export type BasketCard = {
  id: string;
  label: string;
  city: string;
  citySlug: string;
  productName: string;
  imageUrl: string | null;
  deliveryDate: Date;
  cutoffAt: Date;
  cutoffDays: number;
  windowId: string;
  minPricePence: number;
  maxPricePence: number;
  joiners: number;
  grams: number;
};

export type BasketDetail = BasketCard & {
  description: string;
  tiers: TierOption[];
  status: string;
};

export type OrderCard = {
  id: string;
  status: string;
  productName: string;
  city: string;
  tierLabel: string;
  weightGrams: number;
  totalPence: number;
  deliveryDate: Date;
  cancellationDeadline: Date;
  canCancel: boolean;
};

// Integer pence per kg, rounded to the nearest penny — display only.
function pricePerKg(pricePence: number, weightGrams: number): number {
  if (weightGrams <= 0) return 0;
  return Math.round((pricePence * 1000) / weightGrams);
}

// An order can be cancelled while it is still `committed` and no charge has
// been attempted. This mirrors the guard in `joins.ts`; the button must not
// promise something the action will refuse.
function canCancel(order: { status: string; paymentAttemptedAt: Date | null; cancellationDeadline: Date }, now: Date): boolean {
  return (
    order.status === "committed" &&
    order.paymentAttemptedAt === null &&
    now < order.cancellationDeadline
  );
}

// Baskets a customer can join right now: the basket is open, its city is
// active, and that city has an open window ahead.
export async function listOpenBaskets(citySlug?: string): Promise<BasketCard[]> {
  const baskets = await prisma.basket.findMany({
    where: {
      status: "open",
      city: { active: true, ...(citySlug ? { slug: citySlug } : {}) },
    },
    include: {
      city: { include: { windows: { where: { status: "open" }, orderBy: { deliveryDate: "asc" }, take: 1 } } },
      sku: { include: { product: true } },
      tiers: { where: { active: true } },
    },
  });

  const cards: BasketCard[] = [];

  for (const b of baskets) {
    const window = b.city.windows[0];
    if (!window) continue; // no open window: nothing to join
    if (b.tiers.length === 0) continue;

    const orders = await prisma.order.findMany({
      where: {
        basketId: b.id,
        deliveryWindowId: window.id,
        status: { in: DEMAND_COUNTED_STATUSES },
      },
      select: { tier: { select: { weightGrams: true } } },
    });

    const prices = b.tiers.map((t) => t.pricePence);

    cards.push({
      id: b.id,
      label: b.label,
      city: b.city.name,
      citySlug: b.city.slug,
      productName: b.sku.product.name,
      imageUrl: b.sku.product.imageUrl,
      deliveryDate: window.deliveryDate,
      cutoffAt: window.cutoffAt,
      cutoffDays: b.city.cutoffDays,
      windowId: window.id,
      minPricePence: Math.min(...prices),
      maxPricePence: Math.max(...prices),
      joiners: orders.length,
      grams: orders.reduce((sum, o) => sum + o.tier.weightGrams, 0),
    });
  }

  return cards.sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime());
}

export async function getBasketDetail(basketId: string): Promise<BasketDetail | null> {
  const b = await prisma.basket.findUnique({
    where: { id: basketId },
    include: {
      city: { include: { windows: { where: { status: "open" }, orderBy: { deliveryDate: "asc" }, take: 1 } } },
      sku: { include: { product: true } },
      tiers: { where: { active: true }, orderBy: { displayOrder: "asc" } },
    },
  });
  if (!b) return null;

  const window = b.city.windows[0];
  if (!window) return null;

  const orders = await prisma.order.findMany({
    where: {
      basketId: b.id,
      deliveryWindowId: window.id,
      status: { in: DEMAND_COUNTED_STATUSES },
    },
    select: { tier: { select: { weightGrams: true } } },
  });

  const prices = b.tiers.map((t) => t.pricePence);

  return {
    id: b.id,
    label: b.label,
    city: b.city.name,
    citySlug: b.city.slug,
    productName: b.sku.product.name,
    description: b.sku.product.description,
    imageUrl: b.sku.product.imageUrl,
    deliveryDate: window.deliveryDate,
    cutoffAt: window.cutoffAt,
    cutoffDays: b.city.cutoffDays,
    windowId: window.id,
    minPricePence: prices.length ? Math.min(...prices) : 0,
    maxPricePence: prices.length ? Math.max(...prices) : 0,
    joiners: orders.length,
    grams: orders.reduce((sum, o) => sum + o.tier.weightGrams, 0),
    status: b.status,
    tiers: b.tiers.map((t) => ({
      id: t.id,
      label: t.label,
      weightGrams: t.weightGrams,
      pricePence: t.pricePence,
      pricePerKgPence: pricePerKg(t.pricePence, t.weightGrams),
    })),
  };
}

function toOrderCard(
  o: {
    id: string;
    status: string;
    totalPence: number;
    cancellationDeadline: Date;
    paymentAttemptedAt: Date | null;
    tier: { label: string; weightGrams: number };
    basket: { city: { name: string }; sku: { product: { name: string } } };
    window: { deliveryDate: Date };
  },
  now: Date
): OrderCard {
  return {
    id: o.id,
    status: o.status,
    productName: o.basket.sku.product.name,
    city: o.basket.city.name,
    tierLabel: o.tier.label,
    weightGrams: o.tier.weightGrams,
    totalPence: o.totalPence,
    deliveryDate: o.window.deliveryDate,
    cancellationDeadline: o.cancellationDeadline,
    canCancel: canCancel(o, now),
  };
}

const orderInclude = {
  tier: { select: { label: true, weightGrams: true } },
  basket: { include: { city: { select: { name: true } }, sku: { include: { product: { select: { name: true } } } } } },
  window: { select: { deliveryDate: true } },
} as const;

export async function listUserOrders(userId: string): Promise<OrderCard[]> {
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: { userId },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return orders.map((o) => toOrderCard(o, now));
}

export async function getUserOrder(orderId: string, userId: string): Promise<OrderCard | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order || order.userId !== userId) return null;
  return toOrderCard(order, new Date());
}
