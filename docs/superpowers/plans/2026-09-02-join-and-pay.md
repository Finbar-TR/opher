# Join and Pay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete customer journey — browse baskets in your city, join one with a saved card, see your orders, cancel before the cutoff — plus the emails that journey sends.

**Architecture:** Server Components read through a small set of view functions in `src/lib/basket-views.ts`, so pages stay presentational and the queries are tested once. The join flow is the only substantial client component: a three-step form that collects an address, a tier and a card, calling two server actions. Stripe Elements is embedded (no redirect), and the whole flow degrades to a working dev path when no Stripe key is set.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma, Stripe Elements via `@stripe/stripe-js` + `@stripe/react-stripe-js`, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-platform-scheduled-baskets-design.md` — **read its revision notes at the top first.** Revisions 3–5 narrowed the design during the previous plan; §8 and §9 are read subject to them.

**Out of scope — Plan 3 (admin):** city schedule editing, product/SKU management, basket creation and pause/archive, the confirmed-cycles what-to-buy readout, the rollover lever and its joiner notification, per-order refunds in the UI, and the stuck-payment resolver. This plan works against seeded baskets.

## Global Constraints

- Money is integer **pence**; weights integer **grams**. Display only — never compute prices in the UI.
- Statuses are lowercase strings from `src/lib/constants.ts`. Never invent a status.
- **There is no minimum demand.** Every committed order is charged at its window's cutoff. Any copy implying a customer might not be charged is false and must not ship. No progress bar, no target, no percentage, no "if the basket fills".
- **Never hardcode "three days".** The cutoff interval is `city.cutoffDays`, a per-city column. Derive every mention from it.
- The cutoff is **one moment**: joining closes and cards are charged together. Customer-facing copy says so — "cancel free until it closes".
- Every join is free to cancel until `order.cancellationDeadline`, which equals the window's `cutoffAt`.
- Money never moves in this plan's code. Charging belongs to the cron.
- Follow the existing "Warm Kitchen" design system: tokens in `src/app/globals.css` (`--color-bg`, `--color-ink`, `--color-muted`, `--color-line`, `--color-brand-*`, `saffron`, `tomato`), utility classes `.btn-primary`, `.btn-secondary`, `.card`, `.label`, `.input`, `.badge`, and `font-display` for headings. Do not introduce a new palette or component library.
- Two new dependencies are permitted and only these two: `@stripe/stripe-js`, `@stripe/react-stripe-js`.

---

### Task 1: Basket view models

Every screen reads through these, so they are written and tested once, before any page exists.

**Files:**
- Create: `src/lib/basket-views.ts`
- Test: `src/lib/basket-views.integration.test.ts`

**Interfaces:**
- Consumes: `prisma` from `src/lib/prisma.ts`; `DEMAND_COUNTED_STATUSES` from `src/lib/constants.ts`.
- Produces:
  - `type BasketCard = { id: string; label: string; city: string; citySlug: string; productName: string; imageUrl: string | null; deliveryDate: Date; cutoffAt: Date; cutoffDays: number; windowId: string; minPricePence: number; maxPricePence: number; joiners: number; grams: number }`
  - `type BasketDetail = BasketCard & { description: string; tiers: TierOption[]; status: string }`
  - `type TierOption = { id: string; label: string; weightGrams: number; pricePence: number; pricePerKgPence: number }`
  - `type OrderCard = { id: string; status: string; productName: string; city: string; tierLabel: string; weightGrams: number; totalPence: number; deliveryDate: Date; cancellationDeadline: Date; canCancel: boolean }`
  - `listOpenBaskets(citySlug?: string): Promise<BasketCard[]>`
  - `getBasketDetail(basketId: string): Promise<BasketDetail | null>`
  - `listUserOrders(userId: string): Promise<OrderCard[]>`
  - `getUserOrder(orderId: string, userId: string): Promise<OrderCard | null>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/basket-views.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import {
  listOpenBaskets,
  getBasketDetail,
  listUserOrders,
  getUserOrder,
} from "./basket-views";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_VIEWS_" + Date.now();
let citySlug = "";
let basketId = "";
let windowId = "";
let userId = "";
let orderId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} Leeds`,
      slug: `${TAG}-leeds`.toLowerCase(),
      anchorDate: new Date("2026-09-05T00:00:00Z"),
      cutoffDays: 4, // deliberately NOT the default, so copy can't hardcode 3
    },
  });
  citySlug = city.slug;

  const product = await prisma.product.create({
    data: { name: `${TAG} Yam`, description: "Ambient-stable white yam." },
  });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4200,
      purchaseThresholdGrams: 1,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });

  const basket = await prisma.basket.create({
    data: {
      cityId: city.id,
      skuId: sku.id,
      label: `${TAG} Yam — Leeds`,
      createdById: admin.id,
      tiers: {
        create: [
          { label: "Small (2 kg)", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
          { label: "Large (10 kg)", weightGrams: 10000, pricePence: 4000, displayOrder: 2 },
        ],
      },
    },
    include: { tiers: { orderBy: { displayOrder: "asc" } } },
  });
  basketId = basket.id;

  const deliveryDate = new Date("2026-12-19T00:00:00Z");
  const win = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 4) },
  });
  windowId = win.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}-mem@test`, name: "Mem", passwordHash: "x" },
  });
  userId = user.id;

  const order = await prisma.order.create({
    data: {
      userId,
      basketId,
      basketTierId: basket.tiers[1].id,
      deliveryWindowId: windowId,
      status: "committed",
      debitDate: win.cutoffAt,
      cancellationDeadline: win.cutoffAt,
      totalPence: 4000,
      deliveryAddress: "1 Test Street, Leeds LS1 1AA",
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basketId } });
  await prisma.basketTier.deleteMany({ where: { basketId } });
  await prisma.basket.deleteMany({ where: { id: basketId } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("listOpenBaskets", () => {
  it("returns the basket with its price range, window and social proof", async () => {
    const cards = await listOpenBaskets(citySlug);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.id).toBe(basketId);
    expect(c.minPricePence).toBe(950);
    expect(c.maxPricePence).toBe(4000);
    expect(c.windowId).toBe(windowId);
    expect(c.joiners).toBe(1);
    expect(c.grams).toBe(10000);
    expect(c.cutoffDays).toBe(4); // comes from the city, not a constant
  });

  it("filters by city", async () => {
    expect(await listOpenBaskets("no-such-city")).toHaveLength(0);
  });

  it("omits a paused basket", async () => {
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    expect(await listOpenBaskets(citySlug)).toHaveLength(0);
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });

  it("omits a basket whose window has locked", async () => {
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "locked" } });
    expect(await listOpenBaskets(citySlug)).toHaveLength(0);
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "open" } });
  });
});

describe("getBasketDetail", () => {
  it("returns tiers sorted, with price per kg", async () => {
    const d = await getBasketDetail(basketId);
    expect(d).not.toBeNull();
    expect(d!.tiers.map((t) => t.label)).toEqual(["Small (2 kg)", "Large (10 kg)"]);
    // 950p for 2kg = 475p/kg; 4000p for 10kg = 400p/kg
    expect(d!.tiers[0].pricePerKgPence).toBe(475);
    expect(d!.tiers[1].pricePerKgPence).toBe(400);
  });

  it("returns null for an unknown basket", async () => {
    expect(await getBasketDetail("nope")).toBeNull();
  });

  it("omits inactive tiers", async () => {
    const tier = await prisma.basketTier.findFirstOrThrow({ where: { basketId } });
    await prisma.basketTier.update({ where: { id: tier.id }, data: { active: false } });
    const d = await getBasketDetail(basketId);
    expect(d!.tiers).toHaveLength(1);
    await prisma.basketTier.update({ where: { id: tier.id }, data: { active: true } });
  });
});

describe("listUserOrders", () => {
  it("returns the user's order with cancellability", async () => {
    const orders = await listUserOrders(userId);
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(orderId);
    expect(orders[0].tierLabel).toBe("Large (10 kg)");
    expect(orders[0].totalPence).toBe(4000);
    expect(orders[0].canCancel).toBe(true);
  });

  it("marks a charged order as not cancellable", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: "paid" } });
    const orders = await listUserOrders(userId);
    expect(orders[0].canCancel).toBe(false);
    await prisma.order.update({ where: { id: orderId }, data: { status: "committed" } });
  });

  it("returns nothing for a different user", async () => {
    expect(await listUserOrders("someone-else")).toHaveLength(0);
  });
});

describe("getUserOrder", () => {
  it("returns the order for its owner", async () => {
    expect((await getUserOrder(orderId, userId))!.id).toBe(orderId);
  });

  it("returns null for a different user", async () => {
    expect(await getUserOrder(orderId, "someone-else")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/basket-views.integration.test.ts`
Expected: FAIL — cannot resolve `./basket-views`.

- [ ] **Step 3: Implement**

Create `src/lib/basket-views.ts`:

```ts
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
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run src/lib/basket-views.integration.test.ts`
Expected: PASS, 11 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/basket-views.ts src/lib/basket-views.integration.test.ts
git commit -m "feat: basket view models for the customer screens

Read models the pages render, tested once here. Everything time-related
derives from the basket's city, so no screen can hardcode a cutoff
interval that is configurable per city."
```

---

### Task 2: Formatting helpers and the demand note

Small shared pieces every screen needs. Doing them now keeps three later tasks from each inventing their own.

**Files:**
- Modify: `src/lib/money.ts` — add `formatPricePerKg`
- Modify: `src/lib/dates.ts` — add `formatWeekday`, `daysBetween`
- Create: `src/components/demand-note.tsx`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatPricePerKg(pence: number): string` — e.g. `"£4.75/kg"`
  - `formatWeekday(date: Date): string` — e.g. `"Saturday 19 December"`
  - `daysBetween(from: Date, to: Date): number` — whole days, floored, never negative
  - `<DemandNote joiners={n} grams={g} />` — social proof, no bar and no target

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatGBP, formatPricePerKg } from "./money";
import { formatWeekday, daysBetween } from "./dates";

describe("formatPricePerKg", () => {
  it("renders pence per kg as pounds", () => {
    expect(formatPricePerKg(475)).toBe("£4.75/kg");
  });

  it("keeps two decimal places on a round number", () => {
    expect(formatPricePerKg(400)).toBe("£4.00/kg");
  });
});

describe("formatGBP", () => {
  it("still renders plain amounts", () => {
    expect(formatGBP(2200)).toBe("£22.00");
  });
});

describe("formatWeekday", () => {
  it("names the day and date", () => {
    expect(formatWeekday(new Date("2026-12-19T00:00:00Z"))).toBe("Saturday 19 December");
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween(new Date("2026-12-15T08:00:00Z"), new Date("2026-12-19T08:00:00Z"))).toBe(4);
  });

  it("floors a partial day", () => {
    expect(daysBetween(new Date("2026-12-15T23:00:00Z"), new Date("2026-12-19T08:00:00Z"))).toBe(3);
  });

  it("never returns a negative", () => {
    expect(daysBetween(new Date("2026-12-19T08:00:00Z"), new Date("2026-12-15T08:00:00Z"))).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `formatPricePerKg` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/money.ts`:

```ts
// Price per kilogram, for the tier ladder. Input is pence per kg.
export function formatPricePerKg(pencePerKg: number): string {
  return `${formatGBP(pencePerKg)}/kg`;
}
```

Append to `src/lib/dates.ts`:

```ts
// "Saturday 19 December" — the form used wherever a delivery or charge date is
// shown to a customer. Always en-GB, always UTC, so the date a customer reads
// is the date the cron acts on.
export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

// Whole days from `from` to `to`, floored, never negative.
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
```

- [ ] **Step 4: Implement the demand note**

Create `src/components/demand-note.tsx`:

```tsx
// Social proof, deliberately WITHOUT a progress bar, target or percentage.
//
// There is no minimum demand — every order is charged whether two people join
// or twenty — so a progress bar would imply a gate that does not exist, and
// "X% there" would be meaningless. What is true and still persuasive is how
// many neighbours have already joined.

export function DemandNote({ joiners, grams }: { joiners: number; grams: number }) {
  if (joiners === 0) {
    return (
      <p className="text-sm font-medium text-saffron-ink">
        Be the first to join this one.
      </p>
    );
  }

  const kg = Math.round(grams / 100) / 10; // one decimal place

  return (
    <p className="text-sm font-medium text-saffron-ink">
      {joiners === 1 ? "1 neighbour has" : `${joiners} neighbours have`} joined
      {" · "}
      {kg} kg so far
    </p>
  );
}
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run src/lib/format.test.ts && npx tsc --noEmit`
Expected: PASS, 7 cases, clean type check.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts src/lib/dates.ts src/lib/format.test.ts src/components/demand-note.tsx
git commit -m "feat: display helpers and the demand note

The demand note is social proof with no bar, target or percentage: there
is no minimum, so a progress indicator would imply a gate that does not
exist."
```

---

### Task 3: Browse and detail screens

**Files:**
- Create: `src/app/baskets/page.tsx`
- Create: `src/app/baskets/[id]/page.tsx`
- Create: `src/components/basket-card.tsx`
- Modify: `src/components/nav.tsx`, `src/components/mobile-tabbar.tsx` — add a Baskets link

**Interfaces:**
- Consumes: `listOpenBaskets`, `getBasketDetail` from `src/lib/basket-views.ts`; `DemandNote`; `formatGBP`, `formatPricePerKg`, `formatWeekday`, `daysBetween`; `CITIES` from constants.
- Produces: routes `/baskets` and `/baskets/[id]`.

- [ ] **Step 1: Build the card component**

Create `src/components/basket-card.tsx`:

```tsx
import Link from "next/link";
import { PhotoSlot } from "./ui";
import { DemandNote } from "./demand-note";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";
import type { BasketCard as Card } from "@/lib/basket-views";

export function BasketCard({ basket }: { basket: Card }) {
  return (
    <Link href={`/baskets/${basket.id}`} className="card block transition hover:border-line-strong">
      <PhotoSlot src={basket.imageUrl} alt={basket.productName} />
      <div className="mt-4">
        <span className="badge bg-brand-50 text-brand-800">{basket.city}</span>
        <h3 className="mt-2 font-display text-2xl text-ink">{basket.productName}</h3>
        <p className="mt-1 text-sm text-muted">
          Delivered {formatWeekday(basket.deliveryDate)}
        </p>
        <p className="mt-3 text-[15px] font-semibold text-ink">
          {formatGBP(basket.minPricePence)} – {formatGBP(basket.maxPricePence)}
        </p>
        <div className="mt-3">
          <DemandNote joiners={basket.joiners} grams={basket.grams} />
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Build the browse page**

Create `src/app/baskets/page.tsx`:

```tsx
import Link from "next/link";
import { listOpenBaskets } from "@/lib/basket-views";
import { BasketCard } from "@/components/basket-card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// No login required to browse.
export default async function BasketsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city } = await searchParams;
  const [baskets, cities] = await Promise.all([
    listOpenBaskets(city),
    prisma.city.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-[38px] leading-tight text-ink">Baskets near you</h1>
        <p className="mt-1 text-muted">
          Join before a basket closes. Your card is saved now and charged when it
          closes — cancel free until then.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/baskets"
          className={`badge ${!city ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
        >
          All cities
        </Link>
        {cities.map((c) => (
          <Link
            key={c.id}
            href={`/baskets?city=${c.slug}`}
            className={`badge ${city === c.slug ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {baskets.length === 0 ? (
        <div className="card text-center">
          <p className="font-display text-2xl text-ink">
            No baskets in your city yet
          </p>
          <p className="mt-2 text-muted">
            We&apos;re opening new cities as demand grows — check back soon.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {baskets.map((b) => (
            <BasketCard key={b.id} basket={b} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build the detail page**

Create `src/app/baskets/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBasketDetail } from "@/lib/basket-views";
import { DemandNote } from "@/components/demand-note";
import { PhotoSlot } from "@/components/ui";
import { formatGBP, formatPricePerKg } from "@/lib/money";
import { formatWeekday, daysBetween } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function BasketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const basket = await getBasketDetail(id);
  if (!basket) notFound();

  const now = new Date();
  const daysLeft = daysBetween(now, basket.cutoffAt);
  const paused = basket.status === "paused";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link href="/baskets" className="text-sm text-muted hover:underline">
        ← All baskets
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <PhotoSlot src={basket.imageUrl} alt={basket.productName} />
        <div>
          <span className="badge bg-brand-50 text-brand-800">{basket.city}</span>
          <h1 className="mt-3 font-display text-[38px] leading-tight text-ink">
            {basket.productName}
          </h1>
          {basket.description && (
            <p className="mt-3 text-muted">{basket.description}</p>
          )}

          <div className="mt-5 rounded-xl border border-line bg-brand-50 p-4">
            <p className="font-semibold text-ink">
              Delivered {formatWeekday(basket.deliveryDate)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Closes {formatWeekday(basket.cutoffAt)}
              {daysLeft > 0 && ` · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to join`}
            </p>
          </div>

          <div className="mt-4">
            <DemandNote joiners={basket.joiners} grams={basket.grams} />
          </div>

          {paused ? (
            <p className="mt-6 rounded-xl border border-line bg-saffron p-4 text-sm font-medium text-saffron-ink">
              Temporarily paused — existing orders are unaffected.
            </p>
          ) : (
            <Link href={`/baskets/${basket.id}/join`} className="btn-primary mt-6 inline-block">
              Join this basket
            </Link>
          )}
        </div>
      </div>

      <section>
        <h2 className="font-display text-2xl text-ink">Sizes</h2>
        <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
          {basket.tiers.map((t) => (
            <div key={t.id} className="flex items-baseline justify-between px-4 py-3">
              <span className="font-medium text-ink">{t.label}</span>
              <span className="text-right">
                <span className="font-semibold text-ink">{formatGBP(t.pricePence)}</span>
                <span className="ml-2 text-sm text-muted">
                  {formatPricePerKg(t.pricePerKgPence)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="font-display text-2xl text-ink">How it works</h2>
        <ol className="mt-3 space-y-3 text-[15px] text-muted">
          <li>
            <strong className="text-ink">1. Join.</strong> Pick a size and enter
            your card. Nothing is charged yet.
          </li>
          <li>
            <strong className="text-ink">2. The basket closes</strong>{" "}
            {basket.cutoffDays} {basket.cutoffDays === 1 ? "day" : "days"} before
            delivery. That&apos;s when your card is charged — cancel free any
            time before it.
          </li>
          <li>
            <strong className="text-ink">3. Delivery.</strong> Your order arrives
            on {formatWeekday(basket.deliveryDate)}.
          </li>
          <li>
            <strong className="text-ink">If too few neighbours join,</strong> we
            move the delivery to the next date and let you know — you&apos;re
            never charged for a delivery that didn&apos;t run.
          </li>
        </ol>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add navigation**

In `src/components/nav.tsx` and `src/components/mobile-tabbar.tsx`, add a link to `/baskets` labelled "Baskets", following each file's existing link markup exactly. Add an "Orders" link to `/orders` shown only when a user is signed in — both files already receive or fetch the current user; follow whichever pattern is there.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/baskets src/components/basket-card.tsx src/components/nav.tsx src/components/mobile-tabbar.tsx
git commit -m "feat: basket browse and detail screens

City filter, tier ladder with price per kg, and a How it works section
whose cutoff interval comes from the city rather than a hardcoded three
days."
```

---

### Task 4: Join server actions

The server half of the join flow, written and tested before any client code depends on it.

**Files:**
- Create: `src/lib/join-input.ts` — the address schema and its type
- Create: `src/app/baskets/[id]/join/actions.ts`
- Modify: `src/lib/payments.ts` — add `assertPaymentMethodBelongsTo`
- Test: `src/lib/join-actions.integration.test.ts`

**Why the schema lives in its own module:** a `"use server"` file may only
export async functions — Next.js rejects a type or const export from one at
build time. The client component needs the address type, so it cannot come from
`actions.ts`.

**Interfaces:**
- Consumes: `requireUser` from `src/lib/auth.ts`; `ensureStripeCustomer`, `createSetupIntent` from `src/lib/payments.ts`; `joinBasket` from `src/lib/joins.ts`; `prisma`.
- Produces:
  - `startJoin(basketId: string): Promise<{ clientSecret: string | null; setupIntentId: string; devPaymentMethodId?: string }>`
  - `completeJoin(input: { basketId: string; tierId: string; setupIntentId: string; paymentMethodId: string; address: AddressInput; utm?: { source?: string; medium?: string; campaign?: string } }): Promise<{ orderId: string }>`
  - from `src/lib/join-input.ts`: `addressSchema`, and `type AddressInput = { addrLine1: string; addrLine2: string; addrCity: string; postcode: string; phone: string }`
  - `assertPaymentMethodBelongsTo(customerId: string, paymentMethodId: string): Promise<void>`

- [ ] **Step 1: Add the ownership check to payments.ts**

Append to `src/lib/payments.ts`:

```ts
// The client tells us which PaymentMethod the SetupIntent produced. Verify it
// really belongs to this customer before an order is written against it —
// otherwise a crafted request could attach someone else's saved card to its
// own order. With no Stripe key there is nothing to check.
export async function assertPaymentMethodBelongsTo(
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  if (!stripe) return;

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (owner !== customerId) {
    throw new Error("That payment method isn't yours.");
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/join-actions.integration.test.ts`:

```ts
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
vi.mock("./auth", async () => {
  const actual = await vi.importActual<typeof import("./auth")>("./auth");
  return {
    ...actual,
    requireUser: async () => ({
      id: userId,
      email: `${TAG}-mem@test`,
      name: "Mem",
      role: "member" as const,
    }),
  };
});

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

const address = {
  addrLine1: "12 Test Road",
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
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run src/lib/join-actions.integration.test.ts`
Expected: FAIL — cannot resolve the actions module.

- [ ] **Step 4: Implement the actions**

Create `src/app/baskets/[id]/join/actions.ts`:

First create `src/lib/join-input.ts`:

```ts
import { z } from "zod";

// Shared by the server action and the client form. It cannot live in
// `actions.ts`: a "use server" module may export only async functions, so a
// type or const export from there fails the build.
//
// `addrLine2` is a required string that may be empty, rather than optional —
// it keeps the controlled input's value a `string` throughout and spares the
// client component an intersection type to add it back.
export const addressSchema = z.object({
  addrLine1: z.string().trim().min(1, "Enter your address"),
  addrLine2: z.string().trim(),
  addrCity: z.string().trim().min(1, "Enter your town or city"),
  postcode: z.string().trim().min(5, "Enter a valid postcode"),
  phone: z.string().trim().min(6, "Enter a phone number for the courier"),
});

export type AddressInput = z.infer<typeof addressSchema>;
```

Then `src/app/baskets/[id]/join/actions.ts`:

```ts
"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureStripeCustomer,
  createSetupIntent,
  assertPaymentMethodBelongsTo,
} from "@/lib/payments";
import { joinBasket } from "@/lib/joins";
import { formatAddress } from "@/lib/address";
import { addressSchema, type AddressInput } from "@/lib/join-input";
import { sendJoinConfirmation } from "@/lib/notifications";

// Step one of the join: make sure the customer exists at Stripe and open a
// SetupIntent so the browser can collect a card. Nothing is charged, and no
// order exists yet — a customer who abandons here leaves nothing behind.
export async function startJoin(basketId: string): Promise<{
  clientSecret: string | null;
  setupIntentId: string;
  devPaymentMethodId?: string;
}> {
  const user = await requireUser();

  const basket = await prisma.basket.findUniqueOrThrow({ where: { id: basketId } });
  if (basket.status !== "open") {
    throw new Error("This basket is not open for joins right now.");
  }

  const customerId = await ensureStripeCustomer(user.id, user.email, user.name);
  const si = await createSetupIntent(customerId);

  return {
    clientSecret: si.clientSecret,
    setupIntentId: si.id,
    devPaymentMethodId: si.devPaymentMethodId,
  };
}

// Step two: the browser has confirmed the SetupIntent and holds a
// PaymentMethod. Save the delivery address, then create the order.
//
// The Stripe customer id is re-derived server-side and never taken from the
// client, and the PaymentMethod is verified to belong to it — otherwise a
// crafted request could attach someone else's saved card to its own order.
export async function completeJoin(input: {
  basketId: string;
  tierId: string;
  setupIntentId: string;
  paymentMethodId: string;
  address: AddressInput;
  utm?: { source?: string; medium?: string; campaign?: string };
}): Promise<{ orderId: string }> {
  const user = await requireUser();
  const address = addressSchema.parse(input.address);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      addrLine1: address.addrLine1,
      addrLine2: address.addrLine2 ?? null,
      addrCity: address.addrCity,
      postcode: address.postcode,
      phone: address.phone,
    },
  });

  const customerId = await ensureStripeCustomer(user.id, user.email, user.name);
  await assertPaymentMethodBelongsTo(customerId, input.paymentMethodId);

  const result = await joinBasket({
    userId: user.id,
    basketId: input.basketId,
    tierId: input.tierId,
    deliveryAddress: formatAddress({
      addrLine1: address.addrLine1,
      addrLine2: address.addrLine2 || null,
      addrCity: address.addrCity,
      postcode: address.postcode,
    }),
    setupIntentId: input.setupIntentId,
    paymentMethodId: input.paymentMethodId,
    stripeCustomerId: customerId,
    utm: input.utm,
  });

  // The order exists; a failed email must not undo that. Swallow and log.
  try {
    await sendJoinConfirmation(result.orderId);
  } catch (err) {
    console.error(`[email] join confirmation failed for order ${result.orderId}:`, err);
  }

  return result;
}
```

`sendJoinConfirmation` is written in Task 7. Until then, comment out its import
and the `try/catch` above, and restore both in Task 7 — do not leave a
dangling import that breaks the build between commits.

If `formatAddress`'s parameter type does not match the object above, read `src/lib/address.ts` and pass exactly the shape `AddressFields` declares.

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run src/lib/join-actions.integration.test.ts && npx tsc --noEmit`
Expected: PASS, 5 cases.

- [ ] **Step 6: Commit**

```bash
git add "src/app/baskets/[id]/join/actions.ts" src/lib/payments.ts src/lib/join-actions.integration.test.ts
git commit -m "feat: join server actions

startJoin opens a SetupIntent without creating an order, so abandoning
leaves nothing behind. completeJoin re-derives the Stripe customer
server-side and verifies the payment method belongs to it."
```

---

### Task 5: The join flow

The one substantial client component: three steps, Stripe Elements embedded, working without a Stripe key.

**Files:**
- Modify: `package.json` — add `@stripe/stripe-js`, `@stripe/react-stripe-js`
- Create: `src/app/baskets/[id]/join/page.tsx`
- Create: `src/app/baskets/[id]/join/join-flow.tsx`

**Interfaces:**
- Consumes: `startJoin`, `completeJoin` from `./actions`; `getBasketDetail`; `requireUser`.
- Produces: route `/baskets/[id]/join`.

- [ ] **Step 1: Install the Stripe browser libraries**

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

These are the only two dependencies this plan adds. They are required by the spec's "Stripe Elements card input (no redirect — embedded in the PWA)".

Add to `.env.example`:

```
# Publishable key for Stripe Elements in the browser. Without it the join flow
# falls back to a keyless dev path that saves a placeholder card.
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

- [ ] **Step 2: Build the server shell**

Create `src/app/baskets/[id]/join/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getBasketDetail } from "@/lib/basket-views";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JoinFlow } from "./join-flow";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ utm_source?: string; utm_medium?: string; utm_campaign?: string }>;
}) {
  const { id } = await params;
  const utm = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/baskets/${id}/join`);

  const basket = await getBasketDetail(id);
  if (!basket) notFound();
  if (basket.status !== "open") redirect(`/baskets/${id}`);

  // Prefill from the saved address so a returning customer skips retyping.
  const saved = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { addrLine1: true, addrLine2: true, addrCity: true, postcode: true, phone: true },
  });

  return (
    <JoinFlow
      basket={{
        id: basket.id,
        productName: basket.productName,
        city: basket.city,
        deliveryDate: basket.deliveryDate.toISOString(),
        cutoffAt: basket.cutoffAt.toISOString(),
        cutoffDays: basket.cutoffDays,
        tiers: basket.tiers,
      }}
      savedAddress={{
        addrLine1: saved.addrLine1 ?? "",
        addrLine2: saved.addrLine2 ?? "",
        addrCity: saved.addrCity ?? "",
        postcode: saved.postcode ?? "",
        phone: saved.phone ?? "",
      }}
      utm={{ source: utm.utm_source, medium: utm.utm_medium, campaign: utm.utm_campaign }}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
    />
  );
}
```

- [ ] **Step 3: Build the client flow**

Create `src/app/baskets/[id]/join/join-flow.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { startJoin, completeJoin } from "./actions";
import type { AddressInput } from "@/lib/join-input";
import { formatGBP, formatPricePerKg } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

type Tier = {
  id: string;
  label: string;
  weightGrams: number;
  pricePence: number;
  pricePerKgPence: number;
};

type BasketProps = {
  id: string;
  productName: string;
  city: string;
  deliveryDate: string;
  cutoffAt: string;
  cutoffDays: number;
  tiers: Tier[];
};

type Props = {
  basket: BasketProps;
  savedAddress: AddressInput;
  utm: { source?: string; medium?: string; campaign?: string };
  publishableKey: string | null;
};

// The disclosure block. Its wording is a compliance requirement, not a style
// choice: a customer must be told plainly that their card will be charged
// automatically, on which date, and until when they can cancel for free.
function Disclosure({ basket }: { basket: BasketProps }) {
  return (
    <div className="rounded-xl border border-line bg-brand-50 p-4 text-[15px]">
      <p className="text-muted">
        Delivery: <strong className="text-ink">{formatWeekday(new Date(basket.deliveryDate))}</strong>
      </p>
      <p className="mt-1 font-semibold text-ink">
        Your card will be charged on {formatWeekday(new Date(basket.cutoffAt))}
      </p>
      <p className="mt-1 text-muted">Cancel free until then.</p>
    </div>
  );
}

export function JoinFlow({ basket, savedAddress, utm, publishableKey }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState(savedAddress);
  const [tierId, setTierId] = useState(basket.tiers[0]?.id ?? "");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState("");
  const [devPaymentMethodId, setDevPaymentMethodId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tier = basket.tiers.find((t) => t.id === tierId);

  async function goToPayment() {
    setBusy(true);
    setError(null);
    try {
      const res = await startJoin(basket.id);
      setClientSecret(res.clientSecret);
      setSetupIntentId(res.setupIntentId);
      setDevPaymentMethodId(res.devPaymentMethodId);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const stripePromise =
    publishableKey && clientSecret ? loadStripe(publishableKey) : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="font-display text-[32px] leading-tight text-ink">
          Join {basket.productName}
        </h1>
        <p className="mt-1 text-muted">{basket.city}</p>
      </div>

      <ol className="flex gap-2 text-sm">
        {["Address", "Size", "Card"].map((name, i) => (
          <li
            key={name}
            className={`badge ${step === i + 1 ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
          >
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-xl border border-line bg-saffron p-3 text-sm font-medium text-saffron-ink">
          {error}
        </p>
      )}

      {step === 1 && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <div>
            <label className="label" htmlFor="addrLine1">Address</label>
            <input
              id="addrLine1" className="input" required
              value={address.addrLine1}
              onChange={(e) => setAddress({ ...address, addrLine1: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="addrLine2">Address line 2 (optional)</label>
            <input
              id="addrLine2" className="input"
              value={address.addrLine2}
              onChange={(e) => setAddress({ ...address, addrLine2: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="addrCity">Town or city</label>
            <input
              id="addrCity" className="input" required
              value={address.addrCity}
              onChange={(e) => setAddress({ ...address, addrCity: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="postcode">Postcode</label>
            <input
              id="postcode" className="input" required
              value={address.postcode}
              onChange={(e) => setAddress({ ...address, postcode: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone (for the courier)</label>
            <input
              id="phone" className="input" required
              value={address.phone}
              onChange={(e) => setAddress({ ...address, phone: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-primary w-full">Continue</button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {basket.tiers.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center justify-between px-4 py-3">
                <span className="flex items-center gap-3">
                  <input
                    type="radio" name="tier" value={t.id}
                    checked={tierId === t.id}
                    onChange={() => setTierId(t.id)}
                  />
                  <span className="font-medium text-ink">{t.label}</span>
                </span>
                <span className="text-right">
                  <span className="font-semibold text-ink">{formatGBP(t.pricePence)}</span>
                  <span className="ml-2 text-sm text-muted">
                    {formatPricePerKg(t.pricePerKgPence)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Disclosure basket={basket} />
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary flex-1" disabled={!tier || busy} onClick={goToPayment}>
              {busy ? "One moment…" : "Continue to card"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && tier && (
        <div className="space-y-4">
          <div className="card">
            <p className="font-semibold text-ink">
              {basket.productName} · {tier.label}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink">
              {formatGBP(tier.pricePence)}
            </p>
          </div>
          <Disclosure basket={basket} />

          {clientSecret && stripePromise ? (
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <CardStep
                basketId={basket.id}
                tierId={tier.id}
                setupIntentId={setupIntentId}
                address={address}
                utm={utm}
                onError={setError}
              />
            </Elements>
          ) : (
            <DevCardStep
              basketId={basket.id}
              tierId={tier.id}
              setupIntentId={setupIntentId}
              paymentMethodId={devPaymentMethodId ?? ""}
              address={address}
              utm={utm}
              onError={setError}
            />
          )}

          <button className="btn-secondary w-full" onClick={() => setStep(2)}>Back</button>
        </div>
      )}
    </div>
  );
}

type StepProps = {
  basketId: string;
  tierId: string;
  setupIntentId: string;
  address: AddressInput;
  utm: { source?: string; medium?: string; campaign?: string };
  onError: (message: string) => void;
};

function CardStep(props: StepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (error) {
        props.onError(error.message ?? "Your card could not be saved.");
        return;
      }
      const paymentMethodId =
        typeof setupIntent?.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent?.payment_method?.id;
      if (!paymentMethodId) {
        props.onError("Your card could not be saved.");
        return;
      }

      const { orderId } = await completeJoin({
        basketId: props.basketId,
        tierId: props.tierId,
        setupIntentId: props.setupIntentId,
        paymentMethodId,
        address: props.address,
        utm: props.utm,
      });
      router.push(`/orders/${orderId}?joined=1`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <button className="btn-primary w-full" disabled={busy} onClick={submit}>
        {busy ? "Joining…" : "Join basket"}
      </button>
    </div>
  );
}

// The path taken when no Stripe publishable key is configured. It keeps the
// whole flow clickable in local development without keys, exactly as the
// server-side charging code does.
function DevCardStep(props: StepProps & { paymentMethodId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { orderId } = await completeJoin({
        basketId: props.basketId,
        tierId: props.tierId,
        setupIntentId: props.setupIntentId,
        paymentMethodId: props.paymentMethodId,
        address: props.address,
        utm: props.utm,
      });
      router.push(`/orders/${orderId}?joined=1`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-line bg-brand-50 p-3 text-sm text-muted">
        Stripe isn&apos;t configured, so this will save a placeholder card.
      </p>
      <button className="btn-primary w-full" disabled={busy} onClick={submit}>
        {busy ? "Joining…" : "Join basket"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example "src/app/baskets/[id]/join"
git commit -m "feat: multi-step join flow with Stripe Elements

Address, size, card — one page, no reloads. Falls back to a keyless dev
path so the flow is clickable without Stripe keys. The charge disclosure
appears before the card step and again beside it."
```

---

### Task 6: My orders and cancellation

**Files:**
- Create: `src/app/orders/page.tsx`
- Create: `src/app/orders/[id]/page.tsx`
- Create: `src/app/orders/actions.ts`
- Create: `src/components/order-status-badge.tsx`

**Interfaces:**
- Consumes: `listUserOrders`, `getUserOrder`; `cancelOrder` from `src/lib/joins.ts`; `requireUser`.
- Produces: routes `/orders` and `/orders/[id]`; `cancelOrderAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Build the status badge**

Create `src/components/order-status-badge.tsx`:

```tsx
import type { OrderStatus } from "@/lib/constants";

// Customer-facing wording. Deliberately says nothing about minimums or
// baskets filling — every order is charged at its window's cutoff.
const LABELS: Record<OrderStatus, string> = {
  committed: "You're in — not charged yet",
  payment_pending: "Payment in progress",
  paid: "Paid",
  payment_failed: "Payment failed",
  dispatching: "On its way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const TONES: Record<OrderStatus, string> = {
  committed: "bg-brand-50 text-brand-800",
  payment_pending: "bg-brand-50 text-brand-800",
  paid: "bg-brand-100 text-brand-900",
  payment_failed: "bg-saffron text-saffron-ink",
  dispatching: "bg-brand-100 text-brand-900",
  delivered: "bg-brand-100 text-brand-900",
  cancelled: "bg-line text-muted",
  refunded: "bg-line text-muted",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const key = status as OrderStatus;
  return <span className={`badge ${TONES[key] ?? "bg-line text-muted"}`}>{LABELS[key] ?? status}</span>;
}
```

- [ ] **Step 2: Build the cancel action**

Create `src/app/orders/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { cancelOrder } from "@/lib/joins";

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  // cancelOrder owns the rules: it refuses after the deadline, refuses once a
  // charge has been attempted, and detaches the saved card only when no other
  // order still needs it.
  await cancelOrder(orderId, user.id);

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
```

- [ ] **Step 3: Build the orders list**

Create `src/app/orders/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listUserOrders } from "@/lib/basket-views";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await listUserOrders(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-[38px] leading-tight text-ink">Your baskets</h1>

      {orders.length === 0 ? (
        <div className="card text-center">
          <p className="font-display text-2xl text-ink">You haven&apos;t joined a basket yet</p>
          <Link href="/baskets" className="btn-primary mt-4 inline-block">Browse baskets</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="card block transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-xl text-ink">{o.productName}</p>
                  <p className="mt-1 text-sm text-muted">
                    {o.city} · {o.tierLabel}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Delivery {formatWeekday(o.deliveryDate)}
                  </p>
                </div>
                <div className="text-right">
                  <OrderStatusBadge status={o.status} />
                  <p className="mt-2 font-semibold text-ink">{formatGBP(o.totalPence)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build the order detail**

Create `src/app/orders/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getUserOrder } from "@/lib/basket-views";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { cancelOrderAction } from "../actions";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const { id } = await params;
  const { joined } = await searchParams;
  const user = await requireUser();
  const order = await getUserOrder(id, user.id);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/orders" className="text-sm text-muted hover:underline">← Your baskets</Link>

      {joined === "1" && (
        <div className="rounded-xl border border-line bg-brand-50 p-4">
          <p className="font-display text-2xl text-ink">You&apos;re in!</p>
          <p className="mt-1 text-muted">
            We&apos;ll charge your card on {formatWeekday(order.cancellationDeadline)}.
          </p>
        </div>
      )}

      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] leading-tight text-ink">{order.productName}</h1>
            <p className="mt-1 text-muted">{order.city} · {order.tierLabel}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <dl className="mt-5 space-y-2 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-muted">Price</dt>
            <dd className="font-semibold text-ink">{formatGBP(order.totalPence)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Delivery</dt>
            <dd className="text-ink">{formatWeekday(order.deliveryDate)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">
              {order.canCancel ? "Card charged on" : "Charge date"}
            </dt>
            <dd className="text-ink">{formatWeekday(order.cancellationDeadline)}</dd>
          </div>
        </dl>
      </div>

      {order.canCancel ? (
        <form action={cancelOrderAction} className="card">
          <input type="hidden" name="orderId" value={order.id} />
          <p className="text-[15px] text-muted">
            You can cancel free until{" "}
            <strong className="text-ink">{formatWeekday(order.cancellationDeadline)}</strong>.
            After that your card is charged and the order is on its way.
          </p>
          <button type="submit" className="btn-secondary mt-4">Cancel this order</button>
        </form>
      ) : order.status === "committed" ? (
        <p className="text-sm text-muted">
          The cancellation deadline has passed — your card is being charged.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/orders src/components/order-status-badge.tsx
git commit -m "feat: my-orders screens with cancellation

The cancel button is shown only when cancelOrder would actually allow it,
so the UI never promises something the action refuses."
```

---

### Task 7: Transactional emails

Four emails the customer journey needs, wired into the cron that already decides these outcomes.

**Files:**
- Modify: `src/lib/notifications.ts`
- Modify: `src/lib/cycle-run.ts` — send on charge success, charge failure and cap-cancellation
- Modify: `src/app/baskets/[id]/join/actions.ts` — send join confirmation
- Test: `src/lib/notifications.test.ts`

**Interfaces:**
- Consumes: `sendEmail`, `emailLayout`, `emailButton` from `src/lib/email.ts`; `sanitizeAppUrl` from `src/lib/base-url.ts`.
- Produces:
  - `sendJoinConfirmation(orderId: string): Promise<void>`
  - `sendChargeSucceeded(orderId: string): Promise<void>`
  - `sendChargeFailed(orderId: string): Promise<void>`
  - `sendOrderReleased(orderId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/notifications.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: Array<{ to: string; subject: string; html: string }> = [];

vi.mock("./email", () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => {
    sent.push(m);
  },
  emailLayout: (body: string) => body,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
}));

const order = {
  id: "ord_1",
  totalPence: 2200,
  cancellationDeadline: new Date("2026-12-16T08:00:00Z"),
  user: { email: "a@test", name: "Aisha" },
  tier: { label: "Medium (5 kg)" },
  basket: { sku: { product: { name: "White Yam" } }, city: { name: "Sheffield" } },
  window: { deliveryDate: new Date("2026-12-19T00:00:00Z") },
};

vi.mock("./prisma", () => ({
  prisma: {
    order: { findUnique: async () => order },
  },
}));

beforeEach(() => {
  sent.length = 0;
});

describe("sendJoinConfirmation", () => {
  it("names the delivery date, the charge date and how to cancel", async () => {
    const { sendJoinConfirmation } = await import("./notifications");
    await sendJoinConfirmation("ord_1");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("a@test");
    expect(sent[0].html).toContain("White Yam");
    expect(sent[0].html).toContain("Saturday 19 December");
    expect(sent[0].html).toContain("Wednesday 16 December");
    expect(sent[0].html.toLowerCase()).toContain("cancel");
  });

  it("never claims the order might not be charged", async () => {
    const { sendJoinConfirmation } = await import("./notifications");
    await sendJoinConfirmation("ord_1");
    const html = sent[0].html.toLowerCase();
    expect(html).not.toContain("if enough");
    expect(html).not.toContain("minimum");
    expect(html).not.toContain("fills");
  });
});

describe("sendChargeFailed", () => {
  it("explains the retry and links to the order", async () => {
    const { sendChargeFailed } = await import("./notifications");
    await sendChargeFailed("ord_1");
    expect(sent[0].subject.toLowerCase()).toContain("payment");
    expect(sent[0].html).toContain("/orders/ord_1");
  });
});

describe("sendOrderReleased", () => {
  it("tells the customer the order was cancelled and no money was taken", async () => {
    const { sendOrderReleased } = await import("./notifications");
    await sendOrderReleased("ord_1");
    const html = sent[0].html.toLowerCase();
    expect(html).toContain("cancel");
    expect(html).toContain("not been charged");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/notifications.test.ts`
Expected: FAIL — those functions are not exported.

- [ ] **Step 3: Implement the emails**

Add these three imports **to the existing import block at the top** of
`src/lib/notifications.ts` (the file already imports `sendEmail`,
`emailLayout`, `emailButton` and `sanitizeAppUrl`; an import placed mid-file is
a syntax error):

```ts
import { prisma } from "./prisma";
import { formatGBP } from "./money";
import { formatWeekday } from "./dates";
```

Then append the rest to the end of the file:

```ts
// Order emails. None of these may suggest a charge is conditional: every
// committed order is charged at its window's cutoff.

const orderInclude = {
  user: { select: { email: true, name: true } },
  tier: { select: { label: true } },
  basket: { include: { city: { select: { name: true } }, sku: { include: { product: { select: { name: true } } } } } },
  window: { select: { deliveryDate: true } },
} as const;

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
}

function orderLine(o: NonNullable<Awaited<ReturnType<typeof loadOrder>>>): string {
  return `${o.basket.sku.product.name} — ${o.tier.label} (${o.basket.city.name})`;
}

export async function sendJoinConfirmation(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `You're in — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>You've joined <strong>${orderLine(o)}</strong> for ${formatGBP(o.totalPence)}.</p>
       <p>Delivery is <strong>${formatWeekday(o.window.deliveryDate)}</strong>.</p>
       <p>We'll charge your card on <strong>${formatWeekday(o.cancellationDeadline)}</strong>.
          You can cancel free any time before then.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendChargeSucceeded(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Payment received — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We've charged ${formatGBP(o.totalPence)} for <strong>${orderLine(o)}</strong>.</p>
       <p>Delivery is <strong>${formatWeekday(o.window.deliveryDate)}</strong>.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendChargeFailed(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Payment problem — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We couldn't take payment for <strong>${orderLine(o)}</strong>.</p>
       <p>We'll try again over the next couple of days. If your card has changed,
          update it and we'll pick it up automatically.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendOrderReleased(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Order cancelled — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We weren't able to take payment for <strong>${orderLine(o)}</strong>,
          so we've cancelled it. You have <strong>not been charged</strong>.</p>
       <p>You're welcome to join the next delivery whenever you like.</p>
       ${emailButton(`${appUrl()}/baskets`, "Browse baskets")}`
    ),
  });
}
```

- [ ] **Step 4: Wire the emails in**

In `src/app/baskets/[id]/join/actions.ts`, restore the `sendJoinConfirmation`
import and the `try/catch` you commented out in Task 4.

In `src/lib/cycle-run.ts`, add a single helper near the top and call it at each
of the three outcome sites. Every send is swallowed, because an email provider
outage must never break a charging run or leave an order half-resolved:

```ts
// Fire-and-forget notification. A charging run's correctness must never depend
// on an email provider being reachable.
async function notify(fn: (orderId: string) => Promise<void>, orderId: string, kind: string) {
  try {
    await fn(orderId);
  } catch (err) {
    console.error(`[email] ${kind} failed for order ${orderId}:`, err);
  }
}
```

Call sites — each one goes immediately after the database write that settles
the order, inside the existing per-order `try/catch`:

- where an order resolves to `paid` → `await notify(sendChargeSucceeded, order.id, "charge succeeded")`
- where an order resolves to `payment_failed` → `await notify(sendChargeFailed, order.id, "charge failed")`
- where the retry cap **or** the attempt cap releases an order to `cancelled` → `await notify(sendOrderReleased, order.id, "order released")`

The reconciler resolves orders through the same shared helper the charge path
uses, so check whether a single call site there covers the `paid` and
`payment_failed` cases for both. If it does, put the notification there rather
than duplicating it — one site is easier to keep correct than three.

That last one closes the gap left by the previous plan, where a customer's order could be cancelled with only a `console.error` behind it.

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all pass. The cycle-run tests must stay green — if an email call breaks one, the send is in the wrong place or is not swallowed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications.ts src/lib/notifications.test.ts src/lib/cycle-run.ts "src/app/baskets/[id]/join/actions.ts"
git commit -m "feat: order emails

Join confirmation, charge succeeded, charge failed, and order released.
The release email closes the gap where a customer's order could be
cancelled with only a log line behind it. Every send is swallowed on
error so it can never break a join or a charging run."
```

---

### Task 8: Landing page and full verification

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `listOpenBaskets`.
- Produces: a landing page that links into the flow.

- [ ] **Step 1: Rebuild the landing page**

Rewrite `src/app/page.tsx` keeping its existing hero structure and Warm Kitchen styling, changing only what the new screens make possible:

- The primary CTA goes to `/baskets` and reads "See baskets near you".
- Below the hero, show up to three open baskets via `listOpenBaskets()` rendered with `BasketCard`, under a heading "Open now". If there are none, omit the section entirely rather than showing an empty state.
- Keep the three-step explainer, worded exactly as: join and save your card; the basket closes and your card is charged; delivery arrives. Do not state a number of days here — it varies by city.
- Keep the line "Cancel free any time before your basket closes."
- Remove the placeholder comment block at the top of the file, which described this page as a temporary stand-in.

- [ ] **Step 2: Update the README**

In `README.md`, replace the "What's covered" list with one that reflects the customer journey now existing: browse by city, join with a saved card, my-orders with cancellation, and the four order emails. Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to the environment-variables section, describing it as the browser key for Stripe Elements and noting the flow falls back to a keyless dev path without it.

- [ ] **Step 3: Full verification**

Run:

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
npm run db:push && npm run db:seed && npx tsx scripts/seed-scenario.ts
```

Expected: all pass. The suite should be at 120 + the cases added by this plan.

- [ ] **Step 4: Click through the flow**

```bash
npm run dev
```

Then, signed in as `aisha@opher.test` (password `password123`), walk: `/` → `/baskets` → filter by a city → a basket → Join → address → size → the dev card step → the confirmation on `/orders/:id` → Cancel. Confirm the charge date shown matches the basket's cutoff and that cancelling returns the order to a cancelled state.

Record what you saw in the report. If any screen shows a percentage, a progress bar, a target, or the words "minimum" or "if enough", that is a defect — fix it.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx README.md
git commit -m "feat: landing page linking into the basket flow

Shows open baskets and routes into browse. No day count in the explainer
— the cutoff interval is per-city."
```

---

## What Plan 3 covers (admin)

Written after this plan lands:

- City schedules: cadence, anchor date, cutoff days, active toggle.
- Products and SKUs.
- Basket creation with inline tiers, edit, pause and archive.
- The confirmed-cycles **what-to-buy readout** — city, food, delivery date, kilograms — which is what makes buying supply by hand possible, and which must cover **open** windows with hours-to-cutoff so a thin window is visible before its cutoff day.
- **The rollover lever** and its joiner notification, including the collision rule from spec revision 5.
- Per-order refunds over `refundOrder`/`refundWindow`.
- **The stuck-payment resolver** for orders frozen in `payment_pending` awaiting a human — carried forward as a hard requirement from the previous plan.
