# Thin Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator just enough to run one real city end to end — create a basket with tiers, see what to buy and when, and refund money when supply falls through.

**Architecture:** Same shape as the customer screens: read models in one tested lib (`src/lib/admin-views.ts`), Server Components that render them, and Server Actions that call the already-tested domain functions. Every mutating action goes through `requireOperator()`. No new domain logic — refunds, basket status and window generation all exist and are tested.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma, Tailwind v4, Vitest, zod.

**Spec:** `docs/superpowers/specs/2026-09-02-platform-scheduled-baskets-design.md` — **read its revision notes at the top first.** Revisions 3–5 narrowed the design; §8 is the admin surface, read subject to them.

## Why this plan is thin, and what it deliberately leaves out

The full admin surface is easier to design after one real delivery than before it. This plan builds only what a first paid cycle actually needs, and stops.

**In scope:** a minimal product/SKU form, basket creation with inline tiers, pause and archive, the what-to-buy readout, and refunds for a single order or a whole window.

**A scope note worth seeing rather than smuggling:** the product/SKU form was not in the original three. It is here because a basket must point at a SKU, and SKUs currently exist only via the seed — so without it, "create a basket for a real food" still means editing the database by hand, and the plan would not meet its own goal.

**Deliberately out of scope, for a later plan once you've run a delivery:** city schedule editing (seeds set eight cities on a fortnightly cadence; changing one is a database edit for now), the rollover lever, a stuck-payment resolver, a customer-facing way to fix a failed card, per-city analytics, and all supply-chain automation.

## Global Constraints

- Money is integer **pence**; weights integer **grams**. Display only — never compute a price or a charge in a page.
- Statuses are lowercase strings from `src/lib/constants.ts`. Never invent one.
- **Every route and action under `/operator` calls `requireOperator()` first.** It redirects a non-operator to `/`. A missing guard is a data leak, not a style issue.
- **There is no minimum demand.** Every committed order is charged at its window's cutoff. No admin screen may describe a threshold, a target, or a cycle "failing" for want of demand.
- Never hardcode a cutoff interval — it is `city.cutoffDays`, per city.
- **No money moves in this plan's own code.** Refund actions call `refundOrder`/`refundWindow` in `src/lib/refunds.ts`, which are tested and idempotent. Do not reimplement refund logic.
- Follow the existing "Warm Kitchen" design system: tokens in `src/app/globals.css` (`text-ink`, `text-muted`, `text-saffron-ink`, `bg-brand-50`, `bg-brand-100`, `bg-saffron`, `border-line`, `font-display`) and utility classes `.btn-primary`, `.btn-secondary`, `.card`, `.label`, `.input`, `.badge`. No new CSS, no new dependencies.

---

### Task 1: Admin read models

Every admin screen reads through these. Written and tested first, so the pages stay presentational.

**Files:**
- Create: `src/lib/weight.ts`
- Create: `src/lib/admin-views.ts`
- Test: `src/lib/admin-views.integration.test.ts`

**Interfaces:**
- Consumes: `prisma`; `DEMAND_COUNTED_STATUSES` from `src/lib/constants.ts`.
- Produces:
  - `formatKg(grams: number): string` — e.g. `"12.5 kg"`
  - `type AdminBasketRow = { id: string; label: string; city: string; productName: string; skuLabel: string; status: string; tierCount: number; joinersThisCycle: number }`
  - `type CycleRow = { windowId: string; basketId: string; city: string; productName: string; skuLabel: string; deliveryDate: Date; cutoffAt: Date; windowStatus: string; hoursToCutoff: number; joiners: number; grams: number; bulkWeightGrams: number; bulkUnitsNeeded: number }`
  - `type WindowOrderRow = { id: string; userName: string; userEmail: string; tierLabel: string; status: string; totalPence: number; canRefund: boolean }`
  - `listAdminBaskets(): Promise<AdminBasketRow[]>`
  - `listUpcomingCycles(now?: Date): Promise<CycleRow[]>`
  - `listWindowOrders(windowId: string): Promise<WindowOrderRow[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/admin-views.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { formatKg } from "./weight";
import { listAdminBaskets, listUpcomingCycles, listWindowOrders } from "./admin-views";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_ADMIN_" + Date.now();
let basketId = "";
let windowId = "";
let cityId = "";
let paidOrderId = "";

// Delivery 2026-12-19, cutoff 4 days earlier at 08:00 UTC = 2026-12-15T08:00Z.
const DELIVERY = new Date("2026-12-19T00:00:00Z");

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} Leeds`,
      slug: `${TAG}-leeds`.toLowerCase(),
      anchorDate: DELIVERY,
      cutoffDays: 4,
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "25 kg crate",
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
      cityId,
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

  const win = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: DELIVERY, cutoffAt: cutoffAtFor(DELIVERY, 4) },
  });
  windowId = win.id;

  // Three joiners: 10 + 10 + 2 = 22 kg. One paid (refundable), two committed.
  const specs = [
    { tier: 1, status: "paid", pi: "dev_pi_1" },
    { tier: 1, status: "committed", pi: null },
    { tier: 0, status: "committed", pi: null },
  ];
  for (const [i, s] of specs.entries()) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-m${i}@test`, name: `Member ${i}`, passwordHash: "x" },
    });
    const o = await prisma.order.create({
      data: {
        userId: u.id,
        basketId,
        basketTierId: basket.tiers[s.tier].id,
        deliveryWindowId: windowId,
        status: s.status,
        stripePaymentIntentId: s.pi,
        debitDate: win.cutoffAt,
        cancellationDeadline: win.cutoffAt,
        totalPence: s.tier === 1 ? 4000 : 950,
        deliveryAddress: "1 Test Street, Leeds",
      },
    });
    if (s.status === "paid") paidOrderId = o.id;
  }

  // A cancelled order must not count anywhere.
  const cancelled = await prisma.user.create({
    data: { email: `${TAG}-x@test`, name: "Gone", passwordHash: "x" },
  });
  await prisma.order.create({
    data: {
      userId: cancelled.id,
      basketId,
      basketTierId: basket.tiers[1].id,
      deliveryWindowId: windowId,
      status: "cancelled",
      debitDate: win.cutoffAt,
      cancellationDeadline: win.cutoffAt,
      totalPence: 4000,
      deliveryAddress: "1 Test Street, Leeds",
    },
  });
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

describe("formatKg", () => {
  it("renders grams as kilograms to one decimal place", () => {
    expect(formatKg(22000)).toBe("22 kg");
    expect(formatKg(12500)).toBe("12.5 kg");
    expect(formatKg(0)).toBe("0 kg");
  });
});

describe("listAdminBaskets", () => {
  it("returns the basket with its city, food, tier count and joiners", async () => {
    const rows = await listAdminBaskets();
    const row = rows.find((r) => r.id === basketId);
    expect(row).toBeDefined();
    expect(row!.city).toBe(`${TAG} Leeds`);
    expect(row!.productName).toBe(`${TAG} Yam`);
    expect(row!.skuLabel).toBe("25 kg crate");
    expect(row!.tierCount).toBe(2);
    expect(row!.status).toBe("open");
    // 3 counted joiners; the cancelled order is excluded.
    expect(row!.joinersThisCycle).toBe(3);
  });

  it("includes a paused basket — the admin must still see it", async () => {
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    const rows = await listAdminBaskets();
    expect(rows.find((r) => r.id === basketId)!.status).toBe("paused");
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });
});

describe("listUpcomingCycles", () => {
  it("reports demand and how many bulk units to buy", async () => {
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    const row = rows.find((r) => r.basketId === basketId);
    expect(row).toBeDefined();
    expect(row!.grams).toBe(22000);
    expect(row!.joiners).toBe(3);
    expect(row!.bulkWeightGrams).toBe(25000);
    // 22 kg of demand against a 25 kg crate is still one crate.
    expect(row!.bulkUnitsNeeded).toBe(1);
    expect(row!.city).toBe(`${TAG} Leeds`);
    expect(row!.windowStatus).toBe("open");
  });

  it("rounds bulk units UP — a part unit is still a whole purchase", async () => {
    const tier = await prisma.basketTier.findFirstOrThrow({
      where: { basketId, label: "Large (10 kg)" },
    });
    const u = await prisma.user.create({
      data: { email: `${TAG}-extra@test`, name: "Extra", passwordHash: "x" },
    });
    await prisma.order.create({
      data: {
        userId: u.id,
        basketId,
        basketTierId: tier.id,
        deliveryWindowId: windowId,
        status: "committed",
        debitDate: new Date("2026-12-15T08:00:00Z"),
        cancellationDeadline: new Date("2026-12-15T08:00:00Z"),
        totalPence: 4000,
        deliveryAddress: "1 Test Street, Leeds",
      },
    });

    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    const row = rows.find((r) => r.basketId === basketId)!;
    expect(row.grams).toBe(32000); // 22 + 10
    expect(row.bulkUnitsNeeded).toBe(2); // 32 kg needs two 25 kg crates
  });

  it("counts hours to cutoff, going negative once it has passed", async () => {
    const before = await listUpcomingCycles(new Date("2026-12-14T08:00:00Z"));
    expect(before.find((r) => r.basketId === basketId)!.hoursToCutoff).toBe(24);

    const after = await listUpcomingCycles(new Date("2026-12-16T08:00:00Z"));
    expect(after.find((r) => r.basketId === basketId)!.hoursToCutoff).toBe(-24);
  });

  it("omits a window nobody has joined", async () => {
    const empty = await prisma.deliveryWindow.create({
      data: {
        cityId,
        deliveryDate: new Date("2027-01-02T00:00:00Z"),
        cutoffAt: cutoffAtFor(new Date("2027-01-02T00:00:00Z"), 4),
      },
    });
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    expect(rows.find((r) => r.windowId === empty.id)).toBeUndefined();
  });

  it("omits a window already dispatched", async () => {
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "dispatched" } });
    const rows = await listUpcomingCycles(new Date("2026-12-10T09:00:00Z"));
    expect(rows.find((r) => r.windowId === windowId)).toBeUndefined();
    await prisma.deliveryWindow.update({ where: { id: windowId }, data: { status: "open" } });
  });
});

describe("listWindowOrders", () => {
  it("lists every order including cancelled ones, with who placed it", async () => {
    const rows = await listWindowOrders(windowId);
    // 3 counted + 1 cancelled + 1 added by the rounding test.
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.status === "cancelled")).toBe(true);
    expect(rows.every((r) => r.userEmail.startsWith(TAG))).toBe(true);
  });

  it("marks only a paid order refundable", async () => {
    const rows = await listWindowOrders(windowId);
    const paid = rows.find((r) => r.id === paidOrderId)!;
    expect(paid.canRefund).toBe(true);
    expect(rows.filter((r) => r.canRefund)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/admin-views.integration.test.ts`
Expected: FAIL — cannot resolve `./weight`.

- [ ] **Step 3: Implement the weight helper**

Create `src/lib/weight.ts`:

```ts
// Weights are stored in integer grams throughout. This is the only place that
// turns them into something a person reads.

export function formatKg(grams: number): string {
  const kg = Math.round(grams / 100) / 10; // one decimal place
  return `${kg} kg`;
}
```

- [ ] **Step 4: Implement the read models**

Create `src/lib/admin-views.ts`:

```ts
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
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run src/lib/admin-views.integration.test.ts`
Expected: PASS, 10 cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/weight.ts src/lib/admin-views.ts src/lib/admin-views.integration.test.ts
git commit -m "feat: admin read models

The what-to-buy readout covers open windows as well as locked ones — a
thin window has to be visible before its cutoff, because after it the
cards are charged. Bulk units round up: a part unit is a whole purchase.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Operator shell and the product/SKU form

**Files:**
- Modify: `src/app/operator/page.tsx`
- Create: `src/components/operator-nav.tsx`
- Create: `src/app/operator/catalogue/page.tsx`
- Create: `src/app/operator/catalogue/actions.ts`

**Interfaces:**
- Consumes: `requireOperator`; `prisma`; `PRODUCT_CATEGORIES` from constants.
- Produces: `<OperatorNav current="home" | "catalogue" | "baskets" | "cycles" />`; route `/operator/catalogue`; `createProductAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Build the operator sub-nav**

Create `src/components/operator-nav.tsx`:

```tsx
import Link from "next/link";

const LINKS = [
  { key: "home", href: "/operator", label: "Overview" },
  { key: "cycles", href: "/operator/cycles", label: "What to buy" },
  { key: "baskets", href: "/operator/baskets", label: "Baskets" },
  { key: "catalogue", href: "/operator/catalogue", label: "Catalogue" },
] as const;

export function OperatorNav({ current }: { current: string }) {
  return (
    <nav className="mb-8 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          className={`badge ${current === l.key ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Build the catalogue action**

Create `src/app/operator/catalogue/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One form creates a product and its first SKU together. Splitting them would
// mean an operator can save a product they cannot yet sell, which is a state
// worth not having.
const schema = z.object({
  name: z.string().trim().min(1, "Name the food"),
  description: z.string().trim(),
  category: z.enum(["dry", "fresh"]),
  skuLabel: z.string().trim().min(1, "Name the bulk unit, e.g. 25 kg crate"),
  weightKg: z.coerce.number().positive("How many kg is one bulk unit?"),
  wholesaleCostPounds: z.coerce.number().nonnegative("What does one bulk unit cost?"),
});

export async function createProductAction(formData: FormData): Promise<void> {
  await requireOperator();

  const input = schema.parse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    category: formData.get("category"),
    skuLabel: formData.get("skuLabel"),
    weightKg: formData.get("weightKg"),
    wholesaleCostPounds: formData.get("wholesaleCostPounds"),
  });

  await prisma.product.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      skus: {
        create: {
          label: input.skuLabel,
          // Operators think in kg and pounds; storage is grams and pence.
          weightGrams: Math.round(input.weightKg * 1000),
          wholesaleCostPence: Math.round(input.wholesaleCostPounds * 100),
          // Unused this milestone — the purchase trigger was removed in spec
          // revision 4. Set to 1 so the NOT NULL column has a harmless value.
          purchaseThresholdGrams: 1,
        },
      },
    },
  });

  revalidatePath("/operator/catalogue");
  revalidatePath("/operator/baskets");
}
```

- [ ] **Step 3: Build the catalogue page**

Create `src/app/operator/catalogue/page.tsx`:

```tsx
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OperatorNav } from "@/components/operator-nav";
import { createProductAction } from "./actions";
import { formatGBP } from "@/lib/money";
import { formatKg } from "@/lib/weight";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  await requireOperator();
  const products = await prisma.product.findMany({
    include: { skus: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="catalogue" />
      <h1 className="font-display text-[38px] leading-tight text-ink">Catalogue</h1>
      <p className="mt-1 text-muted">
        A food and the bulk unit you buy it in. Baskets point at one of these.
      </p>

      <form action={createProductAction} className="card mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Food</label>
            <input id="name" name="name" className="input" required placeholder="White Yam" />
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <select id="category" name="category" className="input" defaultValue="dry">
              <option value="dry">Dry / shelf-stable</option>
              <option value="fresh">Fresh</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="description">Description</label>
          <input id="description" name="description" className="input" placeholder="Ambient-stable white yam." />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="skuLabel">Bulk unit</label>
            <input id="skuLabel" name="skuLabel" className="input" required placeholder="25 kg crate" />
          </div>
          <div>
            <label className="label" htmlFor="weightKg">Weight (kg)</label>
            <input id="weightKg" name="weightKg" type="number" step="0.1" min="0.1" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="wholesaleCostPounds">Cost (£)</label>
            <input id="wholesaleCostPounds" name="wholesaleCostPounds" type="number" step="0.01" min="0" className="input" required />
          </div>
        </div>
        <button type="submit" className="btn-primary">Add to catalogue</button>
      </form>

      <div className="mt-8 space-y-3">
        {products.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-xl text-ink">{p.name}</span>
              <span className="badge bg-brand-50 text-brand-800">{p.category}</span>
            </div>
            {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {p.skus.map((s) => (
                <li key={s.id}>
                  {s.label} · {formatKg(s.weightGrams)} · {formatGBP(s.wholesaleCostPence)} per unit
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rebuild the operator home**

Replace `src/app/operator/page.tsx` entirely:

```tsx
import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { OperatorNav } from "@/components/operator-nav";

export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/operator/cycles",
    title: "What to buy",
    body: "Every delivery with joiners, how much to order, and how long is left before the cards are charged.",
  },
  {
    href: "/operator/baskets",
    title: "Baskets",
    body: "Open a food in a city, set its sizes, pause it when supply is tight.",
  },
  {
    href: "/operator/catalogue",
    title: "Catalogue",
    body: "The foods you sell and the bulk unit you buy each one in.",
  },
];

export default async function OperatorHome() {
  await requireOperator();

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="home" />
      <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
        Today in the kitchen
      </h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card block transition hover:border-line-strong">
            <p className="font-display text-xl text-ink">{c.title}</p>
            <p className="mt-2 text-sm text-muted">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npx next build && npx vitest run`

Use `npx next build`, **not** `npm run build` — the latter runs `prisma generate`, which fails on this machine with an `EPERM` file-lock on the Windows query-engine DLL. Environmental, not a code problem.

Expected: all pass; `/operator/catalogue` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add src/app/operator src/components/operator-nav.tsx
git commit -m "feat: operator shell and catalogue form

One form creates a food and its bulk unit together — a product without a
SKU is a thing you cannot sell. Operators enter kg and pounds; storage
stays grams and pence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Basket creation, list, pause and archive

**Files:**
- Create: `src/app/operator/baskets/page.tsx`
- Create: `src/app/operator/baskets/actions.ts`
- Create: `src/app/operator/baskets/basket-form.tsx`

**Interfaces:**
- Consumes: `listAdminBaskets` from `admin-views.ts`; `requireOperator`; `prisma`; `BASKET_STATUSES` from constants.
- Produces: route `/operator/baskets`; `createBasketAction(formData: FormData): Promise<void>`; `setBasketStatusAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Build the actions**

Create `src/app/operator/baskets/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const tierSchema = z.object({
  label: z.string().trim().min(1),
  weightKg: z.coerce.number().positive(),
  pricePounds: z.coerce.number().positive(),
});

const basketSchema = z.object({
  cityId: z.string().trim().min(1, "Pick a city"),
  skuId: z.string().trim().min(1, "Pick a food"),
  label: z.string().trim().min(1, "Give the basket a name"),
});

// 2–4 tiers, per the design. One tier is a shop, not a basket; more than four
// is a menu nobody reads on a phone.
const MIN_TIERS = 2;
const MAX_TIERS = 4;

export async function createBasketAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();
  const basket = basketSchema.parse({
    cityId: formData.get("cityId"),
    skuId: formData.get("skuId"),
    label: formData.get("label"),
  });

  // Tier fields arrive as parallel arrays: tierLabel[], tierWeightKg[], tierPricePounds[].
  const labels = formData.getAll("tierLabel").map(String);
  const weights = formData.getAll("tierWeightKg").map(String);
  const prices = formData.getAll("tierPricePounds").map(String);

  const tiers = labels
    .map((label, i) => ({ label, weightKg: weights[i], pricePounds: prices[i] }))
    .filter((t) => t.label.trim() !== "")
    .map((t) => tierSchema.parse(t));

  if (tiers.length < MIN_TIERS || tiers.length > MAX_TIERS) {
    throw new Error(`A basket needs between ${MIN_TIERS} and ${MAX_TIERS} sizes.`);
  }

  // One live basket per food per city. The schema cannot express a partial
  // unique index, so it is enforced here — and archiving one deliberately frees
  // the pair for a new basket.
  const clash = await prisma.basket.findFirst({
    where: { cityId: basket.cityId, skuId: basket.skuId, status: { not: "archived" } },
  });
  if (clash) {
    throw new Error("That city already has a live basket for this food.");
  }

  await prisma.basket.create({
    data: {
      cityId: basket.cityId,
      skuId: basket.skuId,
      label: basket.label,
      createdById: operator.id,
      tiers: {
        create: tiers.map((t, i) => ({
          label: t.label,
          weightGrams: Math.round(t.weightKg * 1000),
          pricePence: Math.round(t.pricePounds * 100),
          displayOrder: i + 1,
        })),
      },
    },
  });

  revalidatePath("/operator/baskets");
  revalidatePath("/baskets");
}

export async function setBasketStatusAction(formData: FormData): Promise<void> {
  await requireOperator();
  const id = String(formData.get("basketId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!id) throw new Error("Missing basket.");
  if (status !== "open" && status !== "paused" && status !== "archived") {
    throw new Error("Unknown status.");
  }

  // Pausing and archiving both stop new joins. Neither touches existing orders:
  // those are already committed, and their customers are owed the delivery they
  // joined for.
  await prisma.basket.update({ where: { id }, data: { status } });

  revalidatePath("/operator/baskets");
  revalidatePath("/baskets");
  revalidatePath(`/baskets/${id}`);
}
```

- [ ] **Step 2: Build the tier form**

Create `src/app/operator/baskets/basket-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createBasketAction } from "./actions";

type Option = { id: string; label: string };

// Four tier rows are rendered up front; empty ones are dropped server-side.
// That keeps the form a plain <form action={...}> with no client state beyond
// the row count, so it works before hydration.
const ROWS = 4;

export function BasketForm({ cities, skus }: { cities: Option[]; skus: Option[] }) {
  const [rows, setRows] = useState(2);

  return (
    <form action={createBasketAction} className="card space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cityId">City</label>
          <select id="cityId" name="cityId" className="input" required>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="skuId">Food</label>
          <select id="skuId" name="skuId" className="input" required>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="label">Basket name</label>
        <input id="label" name="label" className="input" required placeholder="White Yam — Sheffield" />
      </div>

      <fieldset>
        <legend className="label">Sizes (2–4)</legend>
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <input name="tierLabel" className="input" placeholder="Medium (5 kg)" required={i < 2} />
              <input name="tierWeightKg" type="number" step="0.1" min="0.1" className="input" placeholder="kg" required={i < 2} />
              <input name="tierPricePounds" type="number" step="0.01" min="0.01" className="input" placeholder="£" required={i < 2} />
            </div>
          ))}
        </div>
        {rows < ROWS && (
          <button type="button" className="btn-secondary mt-3" onClick={() => setRows(rows + 1)}>
            Add another size
          </button>
        )}
      </fieldset>

      <button type="submit" className="btn-primary">Create basket</button>
    </form>
  );
}
```

- [ ] **Step 3: Build the baskets page**

Create `src/app/operator/baskets/page.tsx`:

```tsx
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listAdminBaskets } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { BasketForm } from "./basket-form";
import { setBasketStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OperatorBasketsPage() {
  await requireOperator();

  const [rows, cities, skus] = await Promise.all([
    listAdminBaskets(),
    prisma.city.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.sku.findMany({ where: { active: true }, include: { product: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="baskets" />
      <h1 className="font-display text-[38px] leading-tight text-ink">Baskets</h1>
      <p className="mt-1 text-muted">
        One food, one city. Customers join these; delivery dates come from the city.
      </p>

      {skus.length === 0 ? (
        <p className="card mt-6 text-muted">
          Add a food to the catalogue first — a basket has to point at one.
        </p>
      ) : (
        <div className="mt-6">
          <BasketForm
            cities={cities.map((c) => ({ id: c.id, label: c.name }))}
            skus={skus.map((s) => ({ id: s.id, label: `${s.product.name} — ${s.label}` }))}
          />
        </div>
      )}

      <div className="mt-8 space-y-3">
        {rows.map((b) => (
          <div key={b.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl text-ink">{b.label}</p>
                <p className="mt-1 text-sm text-muted">
                  {b.city} · {b.productName} ({b.skuLabel}) · {b.tierCount} sizes
                </p>
                <p className="mt-1 text-sm text-muted">
                  {b.joinersThisCycle === 1 ? "1 joiner" : `${b.joinersThisCycle} joiners`} this cycle
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${b.status === "open" ? "bg-brand-100 text-brand-900" : "bg-saffron text-saffron-ink"}`}>
                  {b.status}
                </span>
                <form action={setBasketStatusAction}>
                  <input type="hidden" name="basketId" value={b.id} />
                  <input type="hidden" name="status" value={b.status === "open" ? "paused" : "open"} />
                  <button type="submit" className="font-medium text-brand-700 hover:underline">
                    {b.status === "open" ? "Pause" : "Resume"}
                  </button>
                </form>
                <form action={setBasketStatusAction}>
                  <input type="hidden" name="basketId" value={b.id} />
                  <input type="hidden" name="status" value="archived" />
                  <button type="submit" className="font-medium text-muted hover:underline">
                    Archive
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npx next build && npx vitest run`
Expected: all pass; `/operator/baskets` in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/operator/baskets
git commit -m "feat: basket creation, pause and archive

Enforces one live basket per food per city in application code — Prisma
cannot express the partial unique index, and archiving deliberately frees
the pair. Pausing and archiving stop new joins and leave existing orders
alone; those customers are owed the delivery they joined for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The what-to-buy readout

The screen that makes buying supply by hand possible.

**Files:**
- Create: `src/app/operator/cycles/page.tsx`

**Interfaces:**
- Consumes: `listUpcomingCycles` from `admin-views.ts`; `formatKg`; `formatWeekday`; `requireOperator`.
- Produces: route `/operator/cycles`.

- [ ] **Step 1: Build the page**

Create `src/app/operator/cycles/page.tsx`:

```tsx
import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { listUpcomingCycles } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { formatKg } from "@/lib/weight";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function CyclesPage() {
  await requireOperator();
  const rows = await listUpcomingCycles();

  return (
    <div className="mx-auto max-w-4xl">
      <OperatorNav current="cycles" />
      <h1 className="font-display text-[38px] leading-tight text-ink">What to buy</h1>
      <p className="mt-1 text-muted">
        Every delivery with joiners, soonest first. Order supply before the
        cutoff — after it, cards are charged and the delivery is committed.
      </p>

      {rows.length === 0 ? (
        <p className="card mt-6 text-muted">Nobody has joined an upcoming delivery yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((r) => {
            const closed = r.hoursToCutoff <= 0;
            return (
              <div key={`${r.windowId}-${r.basketId}`} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-xl text-ink">
                      {r.productName} — {r.city}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Delivers {formatWeekday(r.deliveryDate)} · closes {formatWeekday(r.cutoffAt)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {r.joiners === 1 ? "1 joiner" : `${r.joiners} joiners`} · {formatKg(r.grams)} ordered
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-2xl text-ink">
                      {r.bulkUnitsNeeded} × {r.skuLabel}
                    </p>
                    <p className="mt-1 text-sm text-muted">to cover {formatKg(r.grams)}</p>
                    <p
                      className={`mt-2 text-sm font-semibold ${closed ? "text-muted" : "text-saffron-ink"}`}
                    >
                      {closed
                        ? "Closed — cards charged"
                        : `${r.hoursToCutoff} ${r.hoursToCutoff === 1 ? "hour" : "hours"} to order`}
                    </p>
                    <Link
                      href={`/operator/cycles/${r.windowId}`}
                      className="mt-2 inline-block font-medium text-brand-700 hover:underline"
                    >
                      See orders
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint && npx next build && npx vitest run`

`/operator/cycles/[windowId]` does not exist yet — Task 5 builds it. The link will 404 until then; that is expected.

Expected: all pass; `/operator/cycles` in the route list.

- [ ] **Step 3: Commit**

```bash
git add src/app/operator/cycles
git commit -m "feat: what-to-buy readout

Covers open windows as well as locked ones, with hours to cutoff, because
a thin delivery has to be visible before the cards are charged. Leads with
bulk units rather than kilograms — that is what you actually order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Window orders and refunds

**Files:**
- Create: `src/app/operator/cycles/[windowId]/page.tsx`
- Create: `src/app/operator/cycles/[windowId]/actions.ts`

**Interfaces:**
- Consumes: `listWindowOrders` from `admin-views.ts`; `refundOrder`, `refundWindow` from `src/lib/refunds.ts`; `requireOperator`; `OrderStatusBadge` from `src/components/order-status-badge.tsx`.
- Produces: route `/operator/cycles/[windowId]`; `refundOrderAction(formData: FormData): Promise<void>`; `refundWindowAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Build the actions**

Create `src/app/operator/cycles/[windowId]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { refundOrder, refundWindow } from "@/lib/refunds";

// Both actions are thin wrappers. `refundOrder` and `refundWindow` own the
// rules — only a charged order can be refunded, and the Stripe call keys its
// own idempotency on the payment intent, so a double submit collapses into one
// refund rather than two.

export async function refundOrderAction(formData: FormData): Promise<void> {
  await requireOperator();
  const orderId = String(formData.get("orderId") ?? "");
  const windowId = String(formData.get("windowId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  await refundOrder(orderId);

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}

export async function refundWindowAction(formData: FormData): Promise<void> {
  await requireOperator();
  const windowId = String(formData.get("windowId") ?? "");
  if (!windowId) throw new Error("Missing delivery.");

  await refundWindow(windowId);

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}
```

- [ ] **Step 2: Build the page**

Create `src/app/operator/cycles/[windowId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWindowOrders } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { refundOrderAction, refundWindowAction } from "./actions";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function WindowOrdersPage({
  params,
}: {
  params: Promise<{ windowId: string }>;
}) {
  await requireOperator();
  const { windowId } = await params;

  const window = await prisma.deliveryWindow.findUnique({
    where: { id: windowId },
    include: { city: true },
  });
  if (!window) notFound();

  const orders = await listWindowOrders(windowId);
  const refundable = orders.filter((o) => o.canRefund);
  const takings = orders
    .filter((o) => o.status === "paid")
    .reduce((sum, o) => sum + o.totalPence, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="cycles" />
      <Link href="/operator/cycles" className="text-sm text-muted hover:underline">
        ← What to buy
      </Link>

      <h1 className="mt-2 font-display text-[32px] leading-tight text-ink">
        {window.city.name} — {formatWeekday(window.deliveryDate)}
      </h1>
      <p className="mt-1 text-muted">
        {orders.length === 1 ? "1 order" : `${orders.length} orders`} ·{" "}
        {formatGBP(takings)} taken
      </p>

      {refundable.length > 0 && (
        <form action={refundWindowAction} className="card mt-6">
          <p className="text-[15px] text-muted">
            Pulling this delivery? Refunding the whole window returns{" "}
            <strong className="text-ink">{formatGBP(takings)}</strong> to{" "}
            {refundable.length === 1 ? "1 customer" : `${refundable.length} customers`}.
            This cannot be undone.
          </p>
          <input type="hidden" name="windowId" value={windowId} />
          <button type="submit" className="btn-secondary mt-3">
            Refund every paid order
          </button>
        </form>
      )}

      <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
        {orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium text-ink">{o.userName}</p>
              <p className="text-sm text-muted">{o.userEmail} · {o.tierLabel}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-ink">{formatGBP(o.totalPence)}</span>
              <OrderStatusBadge status={o.status} />
              {o.canRefund && (
                <form action={refundOrderAction}>
                  <input type="hidden" name="orderId" value={o.id} />
                  <input type="hidden" name="windowId" value={windowId} />
                  <button type="submit" className="font-medium text-brand-700 hover:underline">
                    Refund
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npx next build && npx vitest run`
Expected: all pass; `/operator/cycles/[windowId]` in the route list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/operator/cycles/[windowId]"
git commit -m "feat: window orders and refunds

Thin wrappers over refundOrder and refundWindow, which own the rules and
key their own Stripe idempotency. The refund button appears only where the
action would allow it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification and README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a verified branch.

- [ ] **Step 1: Run the full suite**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npx next build
```
Expected: all pass. The suite is 149 tests plus the 10 added by Task 1.

- [ ] **Step 2: Walk the operator flow by hand**

```bash
npm run dev
```

Sign in as `operator@opher.test` (password `password123`) and walk:

1. `/operator` → the three cards appear and link correctly.
2. `/operator/catalogue` → add a food with a bulk unit. It appears in the list below with its weight and cost.
3. `/operator/baskets` → create a basket for that food in a city, with two sizes. It appears in the list. Pause it, confirm the badge changes and that `/baskets` no longer offers it. Resume it.
4. Try creating a second basket for the **same city and food** — it must be refused with "That city already has a live basket for this food."
5. `/operator/cycles` → the readout lists any delivery with joiners, showing bulk units and hours to cutoff. Follow "See orders".
6. On the window page, confirm the refund button appears **only** beside orders that are `paid`.

Record what you saw in the report. Do **not** click a refund against real Stripe keys.

- [ ] **Step 3: Confirm a non-operator is locked out**

Sign in as `aisha@opher.test` (a member) and visit `/operator`, `/operator/baskets`, `/operator/cycles` and `/operator/catalogue`. Each must redirect to `/`. Record the result — a missing guard here is a data leak, not a style issue.

- [ ] **Step 4: Update the README**

Add an "Operator" section describing what an operator can now do: manage a catalogue of foods and bulk units, create baskets with sizes, pause and archive them, read what to buy before each cutoff, and refund a single order or a whole delivery. State plainly what is **not** there yet: city schedules are seeded and changed in the database, there is no rollover lever, no resolver for payments frozen awaiting a human, and no self-service way for a customer to fix a failed card.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe the operator surface and what it still lacks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## What a later admin plan still owes

Written once you have run a real delivery and know what the screens actually need:

- **Editing a basket after creation** — its label, and adding or disabling tiers. This plan creates a basket and can pause or archive it, but a mistyped price means archiving and starting again. Spec §8 calls for this; it is left out because a first city can live with re-creating a basket, and the edit rules (what may change once orders exist) deserve their own thought.
- **City schedule editing** — cadence, anchor date, cutoff days, active toggle. Seeded today; a change is a database edit.
- **The rollover lever** and its joiner notification, including the collision rule from spec revision 5. Until it exists, a thin window can only be pulled by refunding it after the cards are charged — which is the expensive way round.
- **A resolver for payments frozen in `payment_pending`** awaiting a human.
- **A self-service way for a customer to fix a failed card.** Without it a failed payment is a dead end, and it is the capability our own failure email was caught promising before it existed.
- Per-city performance, order manifests for the 3PL, and all supply-chain automation.
