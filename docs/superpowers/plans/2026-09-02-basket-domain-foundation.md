# Basket Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Opher's user-organised basket model with the platform-scheduled one — city-level fortnightly delivery cycles, admin-owned baskets with quantity tiers, deferred card capture, and a cutoff-day cron that decides each cycle before any money moves.

**Architecture:** Pure logic separated from database orchestration, following the existing `merge.ts` (pure) / `merge-orders.ts` (DB) split. Date maths and the cutoff decision are pure functions with unit tests; window generation, demand aggregation and the cron are integration-tested against real SQLite. Stripe is wrapped behind one module with a keyless dev fallback, matching how the repo already degrades without `STRIPE_SECRET_KEY`.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + SQLite (dev) / Postgres (prod), Stripe 22 (SetupIntent + off-session PaymentIntent), Vitest 4, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-09-02-platform-scheduled-baskets-design.md` (revision 2)

**This plan covers spec §5–§7, §10–§13.** Admin surface (§8), user surface (§9) and emails (§14) are Plan 2, written after this plan lands.

## Global Constraints

- Money is integer **pence**. Weights are integer **grams**. Never floats for either — both drive purchase decisions (spec §6).
- Statuses are plain lowercase strings in `src/lib/constants.ts`, never Prisma enums. The schema stays provider-portable (see the existing schema header comment).
- `cutoffAt` is **08:00 UTC** on `deliveryDate − city.cutoffDays`. The cron runs at 08:00 UTC. Changing one changes both (spec §6, §7.3).
- Demand counts orders in `committed`, `payment_pending`, `paid`. It excludes `cancelled`, `refunded`, `payment_failed` (spec §11).
- **No charge is ever attempted before the cycle decision.** Threshold and supply feasibility are both evaluated first (spec §5.3).
- Every cron step must be idempotent — a second run in the same day charges nobody twice and raises no duplicate PurchaseOrder (spec §7.3).
- There is no `PURCHASE_PAID_FLOOR`. The 50%-paid floor from v2.1/v3.0 is deliberately absent (spec §5.2).
- The repo uses `prisma db push`, not migrations — there is no `prisma/migrations/` directory.
- Tests follow the existing integration pattern: a `TAG` prefix on all created rows, cleaned up in `afterAll`.

---

### Task 1: Clear the v1.0 model

Deletes the group-buying machinery so the new schema has room. The app must still build and the surviving tests must still pass at the end of this task. UI for baskets disappears entirely here and returns in Plan 2.

**Files:**
- Delete: `src/lib/merge.ts`, `src/lib/merge-orders.ts`, `src/lib/expiry.ts`, `src/lib/postcode.ts`
- Delete: `src/lib/merge.test.ts`, `src/lib/merge-orders.integration.test.ts`, `src/lib/merge-zones.integration.test.ts`, `src/lib/expiry.integration.test.ts`
- Delete: `src/app/baskets/` (whole tree), `src/app/join/`, `src/app/catalog/`, `src/app/operator/commodities/`, `src/app/operator/zones/`, `src/app/api/cron/expire/`
- Delete: `src/app/orders/` (whole tree — rebuilt in Plan 2)
- Modify: `src/app/operator/page.tsx`, `src/app/operator/actions.ts`, `src/app/operator/demand/page.tsx`, `src/app/operator/insights/page.tsx`, `src/app/operator/orders/` — strip anything referencing deleted models
- Modify: `src/components/nav.tsx`, `src/components/mobile-tabbar.tsx` — remove links to deleted routes
- Modify: `src/lib/money.ts` — remove `savings()` (portion-based)
- Modify: `src/lib/notifications.ts` — remove basket/merge/payment notification functions, keep password-reset and email-verification

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `npm run build` and `npm test` pass with auth, account, legal pages and the operator shell intact, and no reference to `Commodity`, `Basket`, `PortionClaim`, `Payment`, `DeliveryZone` outside `prisma/schema.prisma`.

- [ ] **Step 1: Delete the dead modules and their tests**

```bash
git rm -r src/lib/merge.ts src/lib/merge-orders.ts src/lib/expiry.ts src/lib/postcode.ts \
  src/lib/merge.test.ts src/lib/merge-orders.integration.test.ts \
  src/lib/merge-zones.integration.test.ts src/lib/expiry.integration.test.ts \
  src/app/baskets src/app/join src/app/catalog src/app/orders \
  src/app/operator/commodities src/app/operator/zones src/app/api/cron/expire
```

- [ ] **Step 2: Find everything that still references the deleted code**

Run: `npx tsc --noEmit`

Expected: a list of errors in `src/app/operator/*`, `src/components/nav.tsx`, `src/components/mobile-tabbar.tsx`, `src/lib/notifications.ts`, `src/lib/orders.ts`. This list is your work queue for step 3.

- [ ] **Step 3: Strip the referencing code**

For each file in the step 2 list, remove the parts that touch deleted models. Specifics:

- `src/lib/orders.ts` — delete the file; every function on it is `Payment`-based.
- `src/app/api/stripe/webhook/route.ts` — reduce the handler to signature
  verification plus a `default:` branch that logs and returns `{ received: true }`.
  Delete every `checkout.session.*` case and its `Payment` writes. The
  SetupIntent case is added in Task 7.
- `src/lib/notifications.ts` — keep `sendPasswordResetEmail` and `sendVerificationEmail`. Delete every other export and the now-unused imports (`formatGBP`, `ORDER_STATUS_LABELS`, `prisma`).
- `src/lib/money.ts` — delete `savings()`. Keep `formatGBP` and `poundsToPence`.
- `src/app/operator/page.tsx` — reduce to a heading and a placeholder paragraph reading `Basket management returns in the next release.` Remove the counts and the links to deleted routes.
- `src/app/operator/actions.ts` — delete every action referencing `commodity`, `zone`, `basket`, `payment`, or `order`. If the file empties, delete it.
- `src/app/operator/demand/`, `src/app/operator/insights/`, `src/app/operator/orders/` — delete these trees; they are rebuilt in Plan 2.
- `src/components/nav.tsx` and `src/components/mobile-tabbar.tsx` — remove nav entries pointing at `/baskets`, `/catalog`, `/orders`. Leave account, sign-in and the operator link.
- `src/app/page.tsx` — replace any CTA pointing at a deleted route with a link to `/`. Copy is rewritten in Plan 2.

- [ ] **Step 4: Verify the build and the surviving tests**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all four pass. `npm test` reports only `money.test.ts` (which still has `formatGBP`/`poundsToPence` cases — delete any `savings` cases in it).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove v1.0 group-buying model

Deletes the merge engine, portion claims, user-created baskets, invite
codes, delivery zones and the Payment-based order flow, along with the
pages that render them. The schema still declares these models; they go
in the next commit. Basket UI returns in Plan 2."
```

---

### Task 2: New schema and constants

**Files:**
- Modify: `prisma/schema.prisma` (full rewrite of the model section)
- Modify: `src/lib/constants.ts` (full rewrite)
- Test: `src/lib/schema.integration.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `City`, `Product`, `Sku`, `Basket`, `BasketTier`, `DeliveryWindow`, `DemandSnapshot`, `PurchaseOrder`, `Order`, and constants `CITIES`, `BASKET_STATUSES`, `WINDOW_STATUSES`, `ORDER_STATUSES`, `SNAPSHOT_OUTCOMES`, `PO_STATUSES`, `DEMAND_COUNTED_STATUSES`, `CUTOFF_HOUR_UTC`, `DEFAULT_CADENCE_DAYS`, `DEFAULT_CUTOFF_DAYS`, `MAX_PAYMENT_RETRIES`, plus types `BasketStatus`, `WindowStatus`, `OrderStatus`, `SnapshotOutcome`, `PoStatus`.

- [ ] **Step 1: Write the failing smoke test**

Create `src/lib/schema.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/schema.integration.test.ts`
Expected: FAIL — `prisma.city` is not a function (the model does not exist yet).

- [ ] **Step 3: Rewrite the schema**

In `prisma/schema.prisma`, keep the header comment, `generator`, `datasource` and `VerificationToken` unchanged. Replace `User` and every model after it with:

```prisma
// A person with an account. `role` is "member" or "operator" (see constants.ts).
// An operator is the AdminUser of the handoff documents — there is no separate
// admin auth system.
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String
  passwordHash  String
  role          String   @default("member")
  emailVerified Boolean  @default(false)
  createdAt     DateTime @default(now())

  // Delivery address (required before joining, so every order is shippable).
  addrLine1 String?
  addrLine2 String?
  addrCity  String?
  postcode  String?
  phone     String?

  // Stripe Customer, created on first join and reused for later ones.
  stripeCustomerId String?

  orders         Order[]
  createdBaskets Basket[]            @relation("BasketCreator")
  tokens         VerificationToken[]
}

// A city we deliver to. The city — not the basket — owns the delivery schedule:
// every basket in the city shares its dates, so one run per cycle carries all
// foods. Delivery dates are `anchorDate + n * cadenceDays`.
model City {
  id          String   @id @default(cuid())
  name        String   @unique
  slug        String   @unique
  active      Boolean  @default(true)
  cadenceDays Int      @default(14) // fortnightly
  anchorDate  DateTime // any past or future delivery date; the series derives from it
  cutoffDays  Int      @default(3) // joins close this many days before delivery
  createdAt   DateTime @default(now())

  baskets Basket[]
  windows DeliveryWindow[]
}

// Top-level product. `category` is "dry" or "fresh": only dry goods can be
// pre-bought and held at the 3PL (see the spec's supply model).
model Product {
  id          String   @id @default(cuid())
  name        String
  description String   @default("")
  imageUrl    String?
  category    String   @default("dry")
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())

  skus Sku[]
}

// A purchasable variant, supply-side only — customers buy BasketTiers, not SKUs,
// so there is no customer-facing price here. Weights and stock are in GRAMS.
model Sku {
  id                     String   @id @default(cuid())
  productId              String
  label                  String
  weightGrams            Int // the bulk unit we buy from the supplier
  wholesaleCostPence     Int // cost of one bulk unit
  purchaseThresholdGrams Int // demand needed before we buy
  leadTimeDays           Int      @default(2) // PO raised -> goods at the 3PL
  stockAt3pl             Int      @default(0) // grams currently held
  reorderPoint           Int      @default(0) // grams
  active                 Boolean  @default(true)
  createdAt              DateTime @default(now())

  product        Product         @relation(fields: [productId], references: [id])
  baskets        Basket[]
  purchaseOrders PurchaseOrder[]
}

// A platform-scheduled basket: one food, in one city, recurring on that city's
// schedule. Never created by users. Carries no dates of its own.
model Basket {
  id          String   @id @default(cuid())
  cityId      String
  skuId       String
  label       String
  status      String   @default("open") // open|paused|archived
  minJoiners  Int      @default(0) // soft marketing floor; gates nothing
  createdById String
  createdAt   DateTime @default(now())

  city      City             @relation(fields: [cityId], references: [id])
  sku       Sku              @relation(fields: [skuId], references: [id])
  createdBy User             @relation("BasketCreator", fields: [createdById], references: [id])
  tiers     BasketTier[]
  orders    Order[]
  snapshots DemandSnapshot[]
}

// A quantity option within a basket, e.g. "Medium (5 kg)" at £22. This is the
// unit of sale. Price per kg is computed for display, never stored.
model BasketTier {
  id           String  @id @default(cuid())
  basketId     String
  label        String
  weightGrams  Int
  pricePence   Int
  active       Boolean @default(true)
  displayOrder Int     @default(1)

  basket Basket  @relation(fields: [basketId], references: [id])
  orders Order[]
}

// One delivery date for one city. `cutoffAt` is 08:00 UTC on
// deliveryDate - city.cutoffDays: the moment joins close AND cards are charged.
model DeliveryWindow {
  id           String   @id @default(cuid())
  cityId       String
  deliveryDate DateTime
  cutoffAt     DateTime
  status       String   @default("open") // open|locked|dispatched|cancelled
  notes        String   @default("")
  createdAt    DateTime @default(now())

  city           City             @relation(fields: [cityId], references: [id])
  orders         Order[]
  snapshots      DemandSnapshot[]
  purchaseOrders PurchaseOrder[]

  @@unique([cityId, deliveryDate])
}

// The cutoff decision for one basket in one window. Running demand totals are
// computed from orders, not stored here — only the outcome, which cannot be
// recomputed once orders have been cancelled.
model DemandSnapshot {
  id                      String    @id @default(cuid())
  basketId                String
  windowId                String
  outcome                 String    @default("pending") // pending|confirmed|failed
  decidedAt               DateTime?
  demandedGramsAtDecision Int?

  basket Basket         @relation(fields: [basketId], references: [id])
  window DeliveryWindow @relation(fields: [windowId], references: [id])

  @@unique([basketId, windowId])
}

// Our order to the supplier. `windowId` is null on a replenishment PO — stock
// bought ahead of demand rather than against a specific cycle.
model PurchaseOrder {
  id             String   @id @default(cuid())
  skuId          String
  windowId       String?
  quantityGrams  Int
  totalCostPence Int
  status         String   @default("pending") // pending|sent|confirmed|received_at_3pl|failed
  importerRef    String?
  createdAt      DateTime @default(now())

  sku    Sku             @relation(fields: [skuId], references: [id])
  window DeliveryWindow? @relation(fields: [windowId], references: [id])
}

// One user's join to one basket tier for one delivery window. Carries all
// payment state: the card is saved at join and charged at the window's cutoff.
model Order {
  id                    String    @id @default(cuid())
  userId                String
  basketId              String
  basketTierId          String
  deliveryWindowId      String
  status                String    @default("committed")
  stripeCustomerId      String?
  stripeSetupIntentId   String?   @unique
  stripePaymentMethodId String?
  stripePaymentIntentId String?
  debitDate             DateTime // = window.cutoffAt
  cancellationDeadline  DateTime // = window.cutoffAt
  paymentAttemptedAt    DateTime?
  paymentRetryCount     Int       @default(0)
  totalPence            Int // snapshot of tier.pricePence at join
  deliveryAddress       String // snapshot of the member's address at join
  utmSource             String?
  utmMedium             String?
  utmCampaign           String?
  referrerOrderId       String? // schema-ready; unused this milestone
  createdAt             DateTime  @default(now())

  user   User            @relation(fields: [userId], references: [id])
  basket Basket          @relation(fields: [basketId], references: [id])
  tier   BasketTier      @relation(fields: [basketTierId], references: [id])
  window DeliveryWindow  @relation(fields: [deliveryWindowId], references: [id])
  events DeliveryEvent[]

  // One join per person per basket per cycle. To take more, pick a larger tier.
  @@unique([userId, basketId, deliveryWindowId])
}

// Operator-driven delivery status update, shown to members as a timeline.
model DeliveryEvent {
  id        String   @id @default(cuid())
  orderId   String
  status    String
  note      String   @default("")
  createdAt DateTime @default(now())

  order Order @relation(fields: [orderId], references: [id])
}

// Demand captured from people outside any live city — signals where to expand.
model Waitlist {
  id        String   @id @default(cuid())
  email     String
  postcode  String
  city      String? // the city they were looking at, if any
  createdAt DateTime @default(now())
}
```

Note: `Basket` should be unique on (`cityId`, `skuId`) among non-archived rows. SQLite and Prisma cannot express a partial unique index, so this is enforced in application code when creating a basket (Plan 2, admin form).

- [ ] **Step 4: Rewrite the constants**

Replace `src/lib/constants.ts` entirely:

```ts
// Shared string unions and human labels. Kept in one place because the DB stores
// these as plain strings (for schema portability) rather than enums.

export const ROLES = ["member", "operator"] as const;
export type Role = (typeof ROLES)[number];

// The eight UK cities that carry the bulk of the addressable market. Order is
// the display order in dropdowns and filters.
export const CITIES = [
  "London",
  "Birmingham",
  "Manchester",
  "Leeds",
  "Sheffield",
  "Leicester",
  "Bristol",
  "Nottingham",
] as const;
export type CityName = (typeof CITIES)[number];

export const PRODUCT_CATEGORIES = ["dry", "fresh"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const BASKET_STATUSES = ["open", "paused", "archived"] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];

export const BASKET_STATUS_LABELS: Record<BasketStatus, string> = {
  open: "Open — accepting joins",
  paused: "Paused",
  archived: "Archived",
};

export const WINDOW_STATUSES = ["open", "locked", "dispatched", "cancelled"] as const;
export type WindowStatus = (typeof WINDOW_STATUSES)[number];

export const ORDER_STATUSES = [
  "committed",
  "payment_pending",
  "paid",
  "payment_failed",
  "dispatching",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  committed: "You're in — not charged yet",
  payment_pending: "Payment in progress",
  paid: "Paid",
  payment_failed: "Payment failed",
  dispatching: "On its way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// Orders in these statuses count toward a basket's demand for a window.
// cancelled, refunded and payment_failed are excluded.
export const DEMAND_COUNTED_STATUSES: OrderStatus[] = [
  "committed",
  "payment_pending",
  "paid",
];

export const SNAPSHOT_OUTCOMES = ["pending", "confirmed", "failed"] as const;
export type SnapshotOutcome = (typeof SNAPSHOT_OUTCOMES)[number];

export const PO_STATUSES = [
  "pending",
  "sent",
  "confirmed",
  "received_at_3pl",
  "failed",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

// The hour (UTC) at which a window's cutoff falls and the daily cron runs.
// These are the same moment by design: the cutoff IS the charge.
export const CUTOFF_HOUR_UTC = 8;

export const DEFAULT_CADENCE_DAYS = 14; // fortnightly
export const DEFAULT_CUTOFF_DAYS = 3; // joins close 3 days before delivery

// How many future windows to keep open per city, so a customer can always see
// the next delivery and the one after it.
export const OPEN_WINDOWS_AHEAD = 2;

// Charge attempts before an order is released.
export const MAX_PAYMENT_RETRIES = 3;
```

- [ ] **Step 5: Push the schema and regenerate the client**

Run: `npm run db:push && npm run db:generate`
Expected: both succeed. `db:push` will warn about dropping the old tables — accept it; there is no production data on this branch.

- [ ] **Step 6: Run the smoke test**

Run: `npx vitest run src/lib/schema.integration.test.ts`
Expected: PASS, both cases.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/constants.ts src/lib/schema.integration.test.ts
git commit -m "feat: platform-scheduled basket schema

City owns the delivery schedule; Basket is admin-created and carries no
dates; BasketTier is the unit of sale; Order holds all payment state and
is unique per user, basket and window. Weights in grams throughout."
```

---

### Task 3: Cycle date maths

Pure functions, no database. This is the arithmetic every other task depends on.

**Files:**
- Create: `src/lib/cycles.ts`
- Test: `src/lib/cycles.test.ts`

**Interfaces:**
- Consumes: `CUTOFF_HOUR_UTC` from `src/lib/constants.ts`.
- Produces:
  - `cutoffAtFor(deliveryDate: Date, cutoffDays: number): Date`
  - `upcomingDeliveryDates(anchorDate: Date, cadenceDays: number, from: Date, count: number): Date[]`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cycles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cutoffAtFor, upcomingDeliveryDates } from "./cycles";

describe("cutoffAtFor", () => {
  it("lands at 08:00 UTC three days before delivery", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T00:00:00Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });

  it("normalises the delivery time of day away", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T23:45:12Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    const cutoff = cutoffAtFor(new Date("2026-11-02T00:00:00Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-30T08:00:00.000Z");
  });

  it("honours a non-default cutoff length", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T00:00:00Z"), 5);
    expect(cutoff.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });
});

describe("upcomingDeliveryDates", () => {
  const anchor = new Date("2026-09-05T00:00:00Z"); // a Saturday

  it("returns dates on the fortnightly series after `from`", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 2);
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-09-19T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
  });

  it("includes `from` itself when it falls exactly on the series", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-19T00:00:00Z"), 1);
    expect(dates[0].toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });

  it("starts at the anchor when `from` is before it", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-08-01T00:00:00Z"), 2);
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-19T00:00:00.000Z",
    ]);
  });

  it("keeps every date on the same weekday as the anchor", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 6);
    for (const d of dates) expect(d.getUTCDay()).toBe(anchor.getUTCDay());
  });

  it("returns an empty list for a count of zero", () => {
    expect(upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/cycles.test.ts`
Expected: FAIL — cannot resolve `./cycles`.

- [ ] **Step 3: Implement**

Create `src/lib/cycles.ts`:

```ts
// Pure date arithmetic for the city delivery schedule. No database access —
// the DB-facing counterpart is `cycle-run.ts`.

import { CUTOFF_HOUR_UTC } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

// Midnight UTC on the same calendar day.
function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// The moment a window closes to new joins AND its cards are charged: 08:00 UTC,
// `cutoffDays` before the delivery date. Fixed at an hour rather than a rolling
// 72 hours so a single daily cron can own it.
export function cutoffAtFor(deliveryDate: Date, cutoffDays: number): Date {
  const d = startOfUtcDay(deliveryDate);
  d.setUTCDate(d.getUTCDate() - cutoffDays);
  d.setUTCHours(CUTOFF_HOUR_UTC, 0, 0, 0);
  return d;
}

// The next `count` delivery dates on the series `anchorDate + n * cadenceDays`
// that fall on or after `from`. All normalised to midnight UTC, so every date
// keeps the anchor's weekday.
export function upcomingDeliveryDates(
  anchorDate: Date,
  cadenceDays: number,
  from: Date,
  count: number
): Date[] {
  if (count <= 0) return [];

  const anchor = startOfUtcDay(anchorDate);
  const start = startOfUtcDay(from);
  const cadenceMs = cadenceDays * DAY_MS;

  // How many whole cadences past the anchor `start` sits. Negative when `from`
  // precedes the anchor, in which case the series begins at the anchor itself.
  const elapsed = start.getTime() - anchor.getTime();
  const firstIndex = Math.max(0, Math.ceil(elapsed / cadenceMs));

  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(anchor.getTime() + (firstIndex + i) * cadenceMs));
  }
  return dates;
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run src/lib/cycles.test.ts`
Expected: PASS, 9 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cycles.ts src/lib/cycles.test.ts
git commit -m "feat: city delivery-cycle date maths

cutoffAtFor pins the cutoff to 08:00 UTC so one daily cron owns it;
upcomingDeliveryDates walks the anchor + n*cadence series."
```

---

### Task 4: The cutoff decision

Pure logic: given demand and supply facts, decide whether a cycle confirms, and how much to buy. Mirrors the `merge.ts` pure-logic pattern the repo already uses.

**Files:**
- Create: `src/lib/cutoff.ts`
- Test: `src/lib/cutoff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SupplyFacts = { stockAt3pl: number; leadTimeDays: number; purchaseThresholdGrams: number }`
  - `type CycleDecision = { outcome: "confirmed" | "failed"; reason: "met" | "below_threshold" | "not_suppliable"; purchaseGrams: number }`
  - `decideCycle(demandedGrams: number, supply: SupplyFacts, cutoffDays: number): CycleDecision`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cutoff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideCycle } from "./cutoff";

const shortLead = { stockAt3pl: 0, leadTimeDays: 2, purchaseThresholdGrams: 100000 };
const longLead = { stockAt3pl: 0, leadTimeDays: 30, purchaseThresholdGrams: 100000 };

describe("decideCycle", () => {
  it("fails below the threshold and buys nothing", () => {
    const d = decideCycle(50000, shortLead, 3);
    expect(d).toEqual({ outcome: "failed", reason: "below_threshold", purchaseGrams: 0 });
  });

  it("fails on an empty basket", () => {
    expect(decideCycle(0, shortLead, 3).outcome).toBe("failed");
  });

  it("confirms at exactly the threshold", () => {
    const d = decideCycle(100000, shortLead, 3);
    expect(d.outcome).toBe("confirmed");
    expect(d.reason).toBe("met");
  });

  it("buys the shortfall when lead time fits the window", () => {
    expect(decideCycle(120000, shortLead, 3).purchaseGrams).toBe(120000);
  });

  it("buys only the shortfall left after stock", () => {
    const supply = { ...shortLead, stockAt3pl: 40000 };
    expect(decideCycle(120000, supply, 3).purchaseGrams).toBe(80000);
  });

  it("buys nothing when stock covers demand, even on a long lead time", () => {
    const supply = { ...longLead, stockAt3pl: 150000 };
    const d = decideCycle(120000, supply, 3);
    expect(d.outcome).toBe("confirmed");
    expect(d.purchaseGrams).toBe(0);
  });

  it("confirms when stock exactly covers demand", () => {
    const supply = { ...longLead, stockAt3pl: 120000 };
    expect(decideCycle(120000, supply, 3).outcome).toBe("confirmed");
  });

  it("fails when the lead time exceeds the window and stock is short", () => {
    const supply = { ...longLead, stockAt3pl: 40000 };
    const d = decideCycle(120000, supply, 3);
    expect(d).toEqual({ outcome: "failed", reason: "not_suppliable", purchaseGrams: 0 });
  });

  it("treats a lead time equal to the cutoff window as suppliable", () => {
    const supply = { ...shortLead, leadTimeDays: 3 };
    expect(decideCycle(120000, supply, 3).outcome).toBe("confirmed");
  });

  it("checks the threshold before supply, so an unsuppliable empty basket reads as below threshold", () => {
    expect(decideCycle(10, longLead, 3).reason).toBe("below_threshold");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/cutoff.test.ts`
Expected: FAIL — cannot resolve `./cutoff`.

- [ ] **Step 3: Implement**

Create `src/lib/cutoff.ts`:

```ts
// The cutoff-day decision, as pure logic. Given how much demand a basket
// gathered and what supply is available, decide whether the cycle goes ahead
// and how much to buy. No database access, no Stripe.
//
// Nothing here charges anybody: the decision is deliberately taken BEFORE any
// money moves, which is what makes a failed cycle free for the customer.

export type SupplyFacts = {
  stockAt3pl: number; // grams currently held at the 3PL
  leadTimeDays: number; // days from raising a PO to goods being at the 3PL
  purchaseThresholdGrams: number; // demand needed before we buy at all
};

export type CycleDecision = {
  outcome: "confirmed" | "failed";
  reason: "met" | "below_threshold" | "not_suppliable";
  purchaseGrams: number; // 0 when fulfilled entirely from held stock
};

// Supply is feasible either because we already hold enough, or because we can
// buy it in time for this delivery.
function isSuppliable(
  demandedGrams: number,
  supply: SupplyFacts,
  cutoffDays: number
): boolean {
  if (supply.stockAt3pl >= demandedGrams) return true;
  return supply.leadTimeDays <= cutoffDays;
}

export function decideCycle(
  demandedGrams: number,
  supply: SupplyFacts,
  cutoffDays: number
): CycleDecision {
  if (demandedGrams < supply.purchaseThresholdGrams) {
    return { outcome: "failed", reason: "below_threshold", purchaseGrams: 0 };
  }

  if (!isSuppliable(demandedGrams, supply, cutoffDays)) {
    return { outcome: "failed", reason: "not_suppliable", purchaseGrams: 0 };
  }

  // Held stock reduces what we buy; it is not decremented here. Stock moves
  // only when goods physically arrive (PO received) or leave (orders dispatch).
  const purchaseGrams = Math.max(0, demandedGrams - supply.stockAt3pl);
  return { outcome: "confirmed", reason: "met", purchaseGrams };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run src/lib/cutoff.test.ts`
Expected: PASS, 10 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cutoff.ts src/lib/cutoff.test.ts
git commit -m "feat: cutoff-day cycle decision

Threshold first, then supply feasibility: a basket that clears demand but
can be supplied neither from stock nor inside the lead time fails the
cycle rather than charging customers for food that cannot arrive."
```

---

### Task 5: Demand aggregation and window generation

The two database reads/writes the cron leans on.

**Files:**
- Create: `src/lib/demand.ts`
- Create: `src/lib/windows.ts`
- Test: `src/lib/demand.integration.test.ts`

**Interfaces:**
- Consumes: `DEMAND_COUNTED_STATUSES`, `OPEN_WINDOWS_AHEAD` from constants; `cutoffAtFor`, `upcomingDeliveryDates` from `cycles.ts`.
- Produces:
  - `demandedGrams(basketId: string, windowId: string): Promise<number>`
  - `ensureOpenWindows(now: Date): Promise<{ created: number }>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demand.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { demandedGrams } from "./demand";
import { ensureOpenWindows } from "./windows";
import { cutoffAtFor } from "./cycles";

const TAG = "ZZTEST_DEMAND_" + Date.now();
let cityId = "";
let basketId = "";
let windowId = "";
let smallTierId = "";
let largeTierId = "";

async function joiner(suffix: string) {
  return prisma.user.create({
    data: { email: `${TAG}-${suffix}@test`, name: suffix, passwordHash: "x" },
  });
}

beforeAll(async () => {
  const city = await prisma.city.create({
    data: {
      name: `${TAG} City`,
      slug: `${TAG}-city`.toLowerCase(),
      anchorDate: new Date("2026-09-05T00:00:00Z"),
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4000,
      purchaseThresholdGrams: 100000,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });

  const basket = await prisma.basket.create({
    data: {
      cityId,
      skuId: sku.id,
      label: `${TAG} Basket`,
      createdById: admin.id,
      tiers: {
        create: [
          { label: "Small", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
          { label: "Large", weightGrams: 10000, pricePence: 4000, displayOrder: 2 },
        ],
      },
    },
    include: { tiers: { orderBy: { displayOrder: "asc" } } },
  });
  basketId = basket.id;
  smallTierId = basket.tiers[0].id;
  largeTierId = basket.tiers[1].id;

  const deliveryDate = new Date("2026-09-19T00:00:00Z");
  const w = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 3) },
  });
  windowId = w.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basketId } });
  await prisma.demandSnapshot.deleteMany({ where: { basketId } });
  await prisma.basketTier.deleteMany({ where: { basketId } });
  await prisma.basket.deleteMany({ where: { id: basketId } });
  await prisma.purchaseOrder.deleteMany({ where: { sku: { product: { name: { startsWith: TAG } } } } });
  await prisma.deliveryWindow.deleteMany({ where: { cityId } });
  await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

async function join(userId: string, tierId: string, status: string) {
  const tier = await prisma.basketTier.findUniqueOrThrow({ where: { id: tierId } });
  const w = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
  return prisma.order.create({
    data: {
      userId,
      basketId,
      basketTierId: tierId,
      deliveryWindowId: windowId,
      status,
      debitDate: w.cutoffAt,
      cancellationDeadline: w.cutoffAt,
      totalPence: tier.pricePence,
      deliveryAddress: "1 Test Street",
    },
  });
}

describe("demandedGrams", () => {
  it("is zero for a basket nobody has joined", async () => {
    expect(await demandedGrams(basketId, windowId)).toBe(0);
  });

  it("sums tier weights across counted statuses", async () => {
    const a = await joiner("a");
    const b = await joiner("b");
    const c = await joiner("c");
    await join(a.id, smallTierId, "committed"); // 2000
    await join(b.id, largeTierId, "paid"); // 10000
    await join(c.id, largeTierId, "payment_pending"); // 10000
    expect(await demandedGrams(basketId, windowId)).toBe(22000);
  });

  it("excludes cancelled, refunded and failed orders", async () => {
    const d = await joiner("d");
    const e = await joiner("e");
    const f = await joiner("f");
    await join(d.id, largeTierId, "cancelled");
    await join(e.id, largeTierId, "refunded");
    await join(f.id, largeTierId, "payment_failed");
    expect(await demandedGrams(basketId, windowId)).toBe(22000);
  });
});

describe("ensureOpenWindows", () => {
  it("opens two windows ahead for an active city", async () => {
    const now = new Date("2026-10-01T09:00:00Z");
    await ensureOpenWindows(now);
    const open = await prisma.deliveryWindow.findMany({
      where: { cityId, status: "open", deliveryDate: { gte: now } },
      orderBy: { deliveryDate: "asc" },
    });
    expect(open).toHaveLength(2);
    expect(open[0].deliveryDate.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(open[0].cutoffAt.toISOString()).toBe("2026-09-30T08:00:00.000Z");
  });

  it("is idempotent — a second run creates nothing", async () => {
    const now = new Date("2026-10-01T09:00:00Z");
    const second = await ensureOpenWindows(now);
    expect(second.created).toBe(0);
  });

  it("creates nothing for an inactive city", async () => {
    await prisma.city.update({ where: { id: cityId }, data: { active: false } });
    const before = await prisma.deliveryWindow.count({ where: { cityId } });

    // A date far enough ahead that the series would otherwise need new windows.
    await ensureOpenWindows(new Date("2027-03-01T09:00:00Z"));

    expect(await prisma.deliveryWindow.count({ where: { cityId } })).toBe(before);
    await prisma.city.update({ where: { id: cityId }, data: { active: true } });
  });

  it("opens a window locked when its cutoff has already passed", async () => {
    // Anchor in the past: the next series date is behind us, so its cutoff is too.
    const past = await prisma.city.create({
      data: {
        name: `${TAG} Past`,
        slug: `${TAG}-past`.toLowerCase(),
        anchorDate: new Date("2026-09-05T00:00:00Z"),
      },
    });
    await ensureOpenWindows(new Date("2026-09-18T09:00:00Z"));
    const w = await prisma.deliveryWindow.findFirstOrThrow({
      where: { cityId: past.id },
      orderBy: { deliveryDate: "asc" },
    });
    // Delivery 2026-09-19, cutoff 2026-09-16 08:00 — already gone.
    expect(w.status).toBe("locked");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/demand.integration.test.ts`
Expected: FAIL — cannot resolve `./demand`.

- [ ] **Step 3: Implement demand aggregation**

Create `src/lib/demand.ts`:

```ts
import "server-only";
import { prisma } from "./prisma";
import { DEMAND_COUNTED_STATUSES } from "./constants";

// How many grams a basket has gathered for one delivery window.
//
// Computed from orders rather than kept as a running total: a stored counter
// incremented on join and decremented on cancel has two writers, no transaction
// boundary, and drifts silently — and this number drives purchase decisions.
export async function demandedGrams(
  basketId: string,
  windowId: string
): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      basketId,
      deliveryWindowId: windowId,
      status: { in: DEMAND_COUNTED_STATUSES },
    },
    select: { tier: { select: { weightGrams: true } } },
  });

  return orders.reduce((total, o) => total + o.tier.weightGrams, 0);
}
```

- [ ] **Step 4: Implement window generation**

Create `src/lib/windows.ts`:

```ts
import "server-only";
import { prisma } from "./prisma";
import { OPEN_WINDOWS_AHEAD } from "./constants";
import { cutoffAtFor, upcomingDeliveryDates } from "./cycles";

// Keep `OPEN_WINDOWS_AHEAD` future windows open for every active city, so a
// customer can always see the next delivery and the one after it.
//
// Idempotent: windows are unique on (cityId, deliveryDate), and an existing row
// for a date is left exactly as it is — including its status, so a window this
// run has already locked is never reopened.
export async function ensureOpenWindows(now: Date): Promise<{ created: number }> {
  const cities = await prisma.city.findMany({ where: { active: true } });
  let created = 0;

  for (const city of cities) {
    const dates = upcomingDeliveryDates(
      city.anchorDate,
      city.cadenceDays,
      now,
      OPEN_WINDOWS_AHEAD
    );

    for (const deliveryDate of dates) {
      const existing = await prisma.deliveryWindow.findUnique({
        where: { cityId_deliveryDate: { cityId: city.id, deliveryDate } },
      });
      if (existing) continue;

      const cutoffAt = cutoffAtFor(deliveryDate, city.cutoffDays);
      await prisma.deliveryWindow.create({
        data: {
          cityId: city.id,
          deliveryDate,
          cutoffAt,
          // A window whose cutoff has already passed opens locked: it can never
          // accept a join, so no order can exist past its own debit date.
          status: cutoffAt <= now ? "locked" : "open",
        },
      });
      created++;
    }
  }

  return { created };
}
```

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run src/lib/demand.integration.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demand.ts src/lib/windows.ts src/lib/demand.integration.test.ts
git commit -m "feat: demand aggregation and window generation

Demand is summed from orders rather than stored, so it cannot drift.
ensureOpenWindows keeps two cycles open per active city and opens a
window locked when its cutoff has already passed."
```

---

### Task 6: Stripe payment helpers

One module wrapping every Stripe call, with the keyless dev fallback the repo already relies on.

**Files:**
- Create: `src/lib/payments.ts`
- Test: `src/lib/payments.test.ts`

**Interfaces:**
- Consumes: `stripe`, `stripeConfigured` from `src/lib/stripe.ts`.
- Produces:
  - `ensureStripeCustomer(userId: string, email: string, name: string): Promise<string>`
  - `createSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string | null; devPaymentMethodId?: string }>`
  - `chargeOrder(params: { amountPence: number; customerId: string; paymentMethodId: string }): Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }>`
  - `refundPaymentIntent(paymentIntentId: string): Promise<void>`
  - `detachPaymentMethod(paymentMethodId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

These cover the dev fallback, which is the branch that runs without network access. Create `src/lib/payments.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// The dev fallback is what runs with no STRIPE_SECRET_KEY set, and it is the
// path local development and CI take. Mock the stripe module as unconfigured.
vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

beforeEach(() => vi.resetModules());

describe("payments without a Stripe key", () => {
  it("mints a synthetic customer id", async () => {
    const { ensureStripeCustomer } = await import("./payments");
    const id = await ensureStripeCustomer("user_1", "a@test", "A");
    expect(id).toMatch(/^dev_cus_/);
  });

  it("mints a setup intent with a usable dev payment method", async () => {
    const { createSetupIntent } = await import("./payments");
    const si = await createSetupIntent("dev_cus_1");
    expect(si.id).toMatch(/^dev_seti_/);
    expect(si.clientSecret).toBeNull();
    expect(si.devPaymentMethodId).toMatch(/^dev_pm_/);
  });

  it("reports a charge as succeeding", async () => {
    const { chargeOrder } = await import("./payments");
    const result = await chargeOrder({
      amountPence: 2200,
      customerId: "dev_cus_1",
      paymentMethodId: "dev_pm_1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paymentIntentId).toMatch(/^dev_pi_/);
  });

  it("refunds and detaches without throwing", async () => {
    const { refundPaymentIntent, detachPaymentMethod } = await import("./payments");
    await expect(refundPaymentIntent("dev_pi_1")).resolves.toBeUndefined();
    await expect(detachPaymentMethod("dev_pm_1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/payments.test.ts`
Expected: FAIL — cannot resolve `./payments`.

- [ ] **Step 3: Implement**

Create `src/lib/payments.ts`:

```ts
import "server-only";
import { randomBytes } from "crypto";
import { stripe } from "./stripe";
import { prisma } from "./prisma";

// Every Stripe call the basket flow makes lives here.
//
// With no STRIPE_SECRET_KEY the module returns synthetic ids and reports success,
// so the whole join -> cutoff -> charge path is clickable locally without keys.
// This mirrors how the rest of the app already degrades.

const devId = (prefix: string) => `${prefix}_${randomBytes(9).toString("hex")}`;

// Reuse the user's Stripe Customer across joins; create it on the first one.
export async function ensureStripeCustomer(
  userId: string,
  email: string,
  name: string
): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const id = stripe
    ? (await stripe.customers.create({ email, name, metadata: { userId } })).id
    : devId("dev_cus");

  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: id } });
  return id;
}

// Tokenise a card without charging it. `usage: "off_session"` is what lets the
// cutoff cron charge later with no customer present.
export async function createSetupIntent(customerId: string): Promise<{
  id: string;
  clientSecret: string | null;
  devPaymentMethodId?: string;
}> {
  if (!stripe) {
    return {
      id: devId("dev_seti"),
      clientSecret: null,
      devPaymentMethodId: devId("dev_pm"),
    };
  }

  const si = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });
  return { id: si.id, clientSecret: si.client_secret };
}

// Charge a saved card with nobody present. Failures are returned, not thrown —
// the cron records them as payment_failed and retries.
export async function chargeOrder(params: {
  amountPence: number;
  customerId: string;
  paymentMethodId: string;
}): Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }> {
  if (!stripe) return { ok: true, paymentIntentId: devId("dev_pi") };

  try {
    const pi = await stripe.paymentIntents.create({
      amount: params.amountPence,
      currency: "gbp",
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      confirm: true,
      off_session: true,
    });
    return { ok: true, paymentIntentId: pi.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Charge failed" };
  }
}

export async function refundPaymentIntent(paymentIntentId: string): Promise<void> {
  if (!stripe) return;
  await stripe.refunds.create({ payment_intent: paymentIntentId });
}

// Detaching removes the saved card from the customer. Callers must first check
// that no other chargeable order still depends on it.
export async function detachPaymentMethod(paymentMethodId: string): Promise<void> {
  if (!stripe) return;
  await stripe.paymentMethods.detach(paymentMethodId);
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run src/lib/payments.test.ts`
Expected: PASS, 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments.ts src/lib/payments.test.ts
git commit -m "feat: Stripe payment helpers with keyless dev fallback

SetupIntent at join, off-session PaymentIntent at cutoff, refund and
detach. Charge failures are returned rather than thrown so the cron can
record and retry them."
```

---

### Task 7: Join, cancellation and webhook reconciliation

**Files:**
- Create: `src/lib/joins.ts`
- Modify: `src/app/api/stripe/webhook/route.ts`
- Test: `src/lib/joins.integration.test.ts`

**Interfaces:**
- Consumes: `ensureStripeCustomer`, `createSetupIntent`, `detachPaymentMethod` from `payments.ts`.
- Produces:
  - `joinBasket(params: { userId: string; basketId: string; tierId: string; deliveryAddress: string; setupIntentId: string; paymentMethodId: string; stripeCustomerId: string; utm?: { source?: string; medium?: string; campaign?: string } }): Promise<{ orderId: string }>`
  - `cancelOrder(orderId: string, userId: string, now?: Date): Promise<void>`
  - `reconcileSetupIntent(setupIntentId: string, paymentMethodId: string): Promise<void>`
  - All three throw `Error` with a user-safe message on refusal.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/joins.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { joinBasket, cancelOrder, reconcileSetupIntent } from "./joins";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_JOIN_" + Date.now();
let cityId = "";
let basketId = "";
let openWindowId = "";
let lockedWindowId = "";
let tierId = "";
let userId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: { name: `${TAG} City`, slug: `${TAG}-city`.toLowerCase(), anchorDate: new Date("2026-09-05T00:00:00Z") },
  });
  cityId = city.id;
  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: { productId: product.id, label: "Yam", weightGrams: 25000, wholesaleCostPence: 4000, purchaseThresholdGrams: 100000 },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId, skuId: sku.id, label: `${TAG} Basket`, createdById: admin.id,
      tiers: { create: [{ label: "Medium", weightGrams: 5000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  basketId = basket.id;
  tierId = basket.tiers[0].id;

  const openDate = new Date("2026-12-19T00:00:00Z");
  const openWin = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: openDate, cutoffAt: cutoffAtFor(openDate, 3) },
  });
  openWindowId = openWin.id;

  const lockedDate = new Date("2026-12-05T00:00:00Z");
  const lockedWin = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate: lockedDate, cutoffAt: cutoffAtFor(lockedDate, 3), status: "locked" },
  });
  lockedWindowId = lockedWin.id;

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

const joinArgs = () => ({
  userId,
  basketId,
  tierId,
  deliveryAddress: "1 Test Street, S1 1AA",
  setupIntentId: `dev_seti_${Math.random().toString(16).slice(2)}`,
  paymentMethodId: "dev_pm_1",
  stripeCustomerId: "dev_cus_1",
});

describe("joinBasket", () => {
  it("creates a committed order against the next open window", async () => {
    const { orderId } = await joinBasket({ ...joinArgs(), utm: { source: "meta", campaign: "yam-friday" } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    expect(order.status).toBe("committed");
    expect(order.deliveryWindowId).toBe(openWindowId);
    expect(order.totalPence).toBe(2200);
    expect(order.utmSource).toBe("meta");
    expect(order.utmCampaign).toBe("yam-friday");
  });

  it("sets debit date and cancellation deadline to the window cutoff", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { basketId, userId } });
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: openWindowId } });
    expect(order.debitDate.toISOString()).toBe(win.cutoffAt.toISOString());
    expect(order.cancellationDeadline.toISOString()).toBe(win.cutoffAt.toISOString());
  });

  it("refuses a second join to the same basket and cycle", async () => {
    await expect(joinBasket(joinArgs())).rejects.toThrow(/already joined/i);
  });

  it("refuses when the basket is paused", async () => {
    const other = await prisma.user.create({ data: { email: `${TAG}-p@test`, name: "P", passwordHash: "x" } });
    await prisma.basket.update({ where: { id: basketId }, data: { status: "paused" } });
    await expect(joinBasket({ ...joinArgs(), userId: other.id })).rejects.toThrow(/not open/i);
    await prisma.basket.update({ where: { id: basketId }, data: { status: "open" } });
  });

  it("refuses when no window is open", async () => {
    const other = await prisma.user.create({ data: { email: `${TAG}-n@test`, name: "N", passwordHash: "x" } });
    await prisma.deliveryWindow.update({ where: { id: openWindowId }, data: { status: "locked" } });
    await expect(joinBasket({ ...joinArgs(), userId: other.id })).rejects.toThrow(/closed/i);
    await prisma.deliveryWindow.update({ where: { id: openWindowId }, data: { status: "open" } });
  });
});

describe("cancelOrder", () => {
  it("cancels before the deadline", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { basketId, userId } });
    await cancelOrder(order.id, userId, new Date("2026-12-01T00:00:00Z"));
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
    expect(after.stripePaymentMethodId).toBeNull();
  });

  it("refuses after the deadline", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-late@test`, name: "L", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: u.id });
    await expect(cancelOrder(orderId, u.id, new Date("2026-12-18T00:00:00Z"))).rejects.toThrow(/deadline/i);
  });

  it("refuses once a charge has been attempted", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-chg@test`, name: "C", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: u.id });
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "payment_failed", paymentAttemptedAt: new Date() },
    });
    await expect(cancelOrder(orderId, u.id, new Date("2026-12-01T00:00:00Z"))).rejects.toThrow(/cannot be cancelled/i);
  });

  it("refuses to cancel someone else's order", async () => {
    const owner = await prisma.user.create({ data: { email: `${TAG}-own@test`, name: "O", passwordHash: "x" } });
    const stranger = await prisma.user.create({ data: { email: `${TAG}-str@test`, name: "S", passwordHash: "x" } });
    const { orderId } = await joinBasket({ ...joinArgs(), userId: owner.id });
    await expect(cancelOrder(orderId, stranger.id, new Date("2026-12-01T00:00:00Z"))).rejects.toThrow();
  });

  it("lets a cancelled joiner rejoin the same cycle", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-again@test`, name: "A", passwordHash: "x" } });
    const first = await joinBasket({ ...joinArgs(), userId: u.id });
    await cancelOrder(first.orderId, u.id, new Date("2026-12-01T00:00:00Z"));

    const second = await joinBasket({ ...joinArgs(), userId: u.id });
    expect(second.orderId).toBe(first.orderId); // the row is reused
    const order = await prisma.order.findUniqueOrThrow({ where: { id: second.orderId } });
    expect(order.status).toBe("committed");
    expect(order.stripePaymentMethodId).toBe("dev_pm_1");
  });
});

describe("reconcileSetupIntent", () => {
  it("fills in a payment method the join request did not record", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-rec@test`, name: "R", passwordHash: "x" } });
    const args = joinArgs();
    const { orderId } = await joinBasket({ ...args, userId: u.id });
    await prisma.order.update({ where: { id: orderId }, data: { stripePaymentMethodId: null } });

    await reconcileSetupIntent(args.setupIntentId, "dev_pm_recovered");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.stripePaymentMethodId).toBe("dev_pm_recovered");
  });

  it("leaves an already-recorded payment method alone", async () => {
    const u = await prisma.user.create({ data: { email: `${TAG}-rec2@test`, name: "R2", passwordHash: "x" } });
    const args = joinArgs();
    const { orderId } = await joinBasket({ ...args, userId: u.id });

    await reconcileSetupIntent(args.setupIntentId, "dev_pm_other");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.stripePaymentMethodId).toBe("dev_pm_1");
  });

  it("is a no-op for a setup intent with no order", async () => {
    await expect(reconcileSetupIntent("dev_seti_orphan", "dev_pm_x")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/joins.integration.test.ts`
Expected: FAIL — cannot resolve `./joins`.

- [ ] **Step 3: Implement**

Create `src/lib/joins.ts`:

```ts
import "server-only";
import { prisma } from "./prisma";
import { detachPaymentMethod } from "./payments";

// Joining a basket IS the order — there is no cart. The card is saved at join
// and charged at the window's cutoff, so a join costs the customer nothing
// until then.

export type JoinParams = {
  userId: string;
  basketId: string;
  tierId: string;
  deliveryAddress: string;
  setupIntentId: string;
  paymentMethodId: string;
  stripeCustomerId: string;
  utm?: { source?: string; medium?: string; campaign?: string };
};

export async function joinBasket(params: JoinParams): Promise<{ orderId: string }> {
  const basket = await prisma.basket.findUniqueOrThrow({
    where: { id: params.basketId },
    include: { city: true },
  });
  if (basket.status !== "open") {
    throw new Error("This basket is not open for joins right now.");
  }

  const tier = await prisma.basketTier.findUniqueOrThrow({ where: { id: params.tierId } });
  if (tier.basketId !== basket.id || !tier.active) {
    throw new Error("That option is no longer available.");
  }

  // The soonest open window for the basket's city. Re-read at submit time so a
  // window that locked while the user was filling the form is caught here.
  const window = await prisma.deliveryWindow.findFirst({
    where: { cityId: basket.cityId, status: "open" },
    orderBy: { deliveryDate: "asc" },
  });
  if (!window) {
    throw new Error("Joining is closed for this delivery. Check back for the next one.");
  }

  const existing = await prisma.order.findUnique({
    where: {
      userId_basketId_deliveryWindowId: {
        userId: params.userId,
        basketId: basket.id,
        deliveryWindowId: window.id,
      },
    },
  });
  if (existing && existing.status !== "cancelled") {
    throw new Error("You've already joined this basket for this delivery.");
  }

  const fields = {
    basketTierId: tier.id,
    status: "committed",
    stripeCustomerId: params.stripeCustomerId,
    stripeSetupIntentId: params.setupIntentId,
    stripePaymentMethodId: params.paymentMethodId,
    // Both derive from the window's cutoff: one date, not two.
    debitDate: window.cutoffAt,
    cancellationDeadline: window.cutoffAt,
    totalPence: tier.pricePence, // snapshot, so later price edits don't apply
    deliveryAddress: params.deliveryAddress,
    utmSource: params.utm?.source ?? null,
    utmMedium: params.utm?.medium ?? null,
    utmCampaign: params.utm?.campaign ?? null,
  };

  // Someone who cancelled and changed their mind reuses their existing row —
  // the unique key on (user, basket, window) means a second insert would fail.
  const order = existing
    ? await prisma.order.update({
        where: { id: existing.id },
        data: { ...fields, paymentAttemptedAt: null, paymentRetryCount: 0 },
      })
    : await prisma.order.create({
        data: {
          userId: params.userId,
          basketId: basket.id,
          deliveryWindowId: window.id,
          ...fields,
        },
      });

  return { orderId: order.id };
}

export async function cancelOrder(
  orderId: string,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.userId !== userId) throw new Error("That isn't your order.");

  // Never unwind an order a charge has been attempted on, even a failed one —
  // the retry flow owns those, and an admin refund handles the rest.
  if (order.status !== "committed" || order.paymentAttemptedAt) {
    throw new Error("This order cannot be cancelled.");
  }
  if (now >= order.cancellationDeadline) {
    throw new Error("The cancellation deadline has passed.");
  }

  const paymentMethodId = order.stripePaymentMethodId;

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "cancelled", stripePaymentMethodId: null },
  });

  // Detach only when nothing else still needs this card: a user with two
  // committed joins shares one saved card, and detaching unconditionally would
  // silently break the charge for the other one.
  if (paymentMethodId) {
    const stillInUse = await prisma.order.count({
      where: {
        userId,
        stripePaymentMethodId: paymentMethodId,
        status: { in: ["committed", "payment_pending", "payment_failed"] },
      },
    });
    if (stillInUse === 0) await detachPaymentMethod(paymentMethodId);
  }
}

// Stripe's setup_intent.succeeded arriving after the join request already wrote
// the order. The order is NOT created here: doing so would race the
// confirmation screen, and a slow webhook would be indistinguishable from a
// lost order. This only fills a gap the join request left.
//
// Idempotent, and safe to receive more than once: stripeSetupIntentId is unique.
export async function reconcileSetupIntent(
  setupIntentId: string,
  paymentMethodId: string
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripeSetupIntentId: setupIntentId },
  });

  if (!order) {
    // An orphaned SetupIntent: the customer abandoned the flow after Stripe
    // confirmed. Nothing to do, but worth seeing in the logs.
    console.warn(`[stripe] setup_intent ${setupIntentId} has no order`);
    return;
  }

  if (order.stripePaymentMethodId) return;

  await prisma.order.update({
    where: { id: order.id },
    data: { stripePaymentMethodId: paymentMethodId },
  });
}
```

- [ ] **Step 4: Wire the webhook**

In `src/app/api/stripe/webhook/route.ts`, add a case to the event switch left
behind by Task 1:

```ts
case "setup_intent.succeeded": {
  const si = event.data.object as Stripe.SetupIntent;
  const paymentMethodId =
    typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  if (paymentMethodId) await reconcileSetupIntent(si.id, paymentMethodId);
  break;
}
```

Import `reconcileSetupIntent` from `@/lib/joins` and `Stripe` from `stripe` at
the top of the file if they are not already imported.

- [ ] **Step 5: Run to confirm they pass**

Run: `npx vitest run src/lib/joins.integration.test.ts && npx tsc --noEmit`
Expected: PASS, 13 cases, and a clean type check.

- [ ] **Step 6: Commit**

```bash
git add src/lib/joins.ts src/lib/joins.integration.test.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat: join, cancel, and reconcile the SetupIntent webhook

Join creates a committed order against the city's next open window, with
debit date and cancellation deadline both taken from its cutoff. Cancel
detaches the saved card only when no other chargeable order needs it. The
webhook fills gaps rather than creating orders, so it cannot race the
confirmation screen."
```

---

### Task 8: The cutoff-day cron

The heart of the model: lock, decide, then charge — in that order.

**Files:**
- Create: `src/lib/cycle-run.ts`
- Create: `src/app/api/cron/cycles/route.ts`
- Modify: `vercel.json`
- Modify: `vitest.config.ts`
- Test: `src/lib/cycle-run.integration.test.ts`

**Interfaces:**
- Consumes: `ensureOpenWindows` from `windows.ts`; `demandedGrams` from `demand.ts`; `decideCycle` from `cutoff.ts`; `chargeOrder` from `payments.ts`; `MAX_PAYMENT_RETRIES` from constants.
- Produces: `runCycles(now?: Date): Promise<{ windowsCreated: number; windowsLocked: number; confirmed: number; failed: number; charged: number; chargeFailures: number; released: number }>`

- [ ] **Step 1: Make integration tests run serially**

`runCycles` operates on every city and every failed order in the database, not
just the ones a given test created — so two test files touching the shared
`dev.db` in parallel will interfere. Add `fileParallelism: false` to
`vitest.config.ts`:

```ts
  test: {
    // Integration tests share one SQLite file, and runCycles sweeps globally,
    // so files must not run concurrently.
    fileParallelism: false,
    env: {
      // Prisma resolves file:./dev.db relative to the schema directory.
      DATABASE_URL: "file:./dev.db",
    },
  },
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/cycle-run.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { runCycles } from "./cycle-run";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_CRON_" + Date.now();
const DELIVERY = new Date("2026-11-21T00:00:00Z");
const CUTOFF = cutoffAtFor(DELIVERY, 3); // 2026-11-18T08:00:00Z
const AT_CUTOFF = new Date("2026-11-18T08:00:00Z");

let skuId = "";
let adminId = "";
let cityId = "";

// Each test builds its own city so runs cannot interfere.
async function scenario(opts: {
  tierGrams: number;
  joiners: number;
  threshold: number;
  stockAt3pl?: number;
  leadTimeDays?: number;
}) {
  const suffix = Math.random().toString(16).slice(2, 8);
  const city = await prisma.city.create({
    data: {
      name: `${TAG} ${suffix}`,
      slug: `${TAG}-${suffix}`.toLowerCase(),
      anchorDate: DELIVERY,
      active: false, // keep ensureOpenWindows out of these fixtures
    },
  });
  cityId = city.id;

  const product = await prisma.product.create({ data: { name: `${TAG} ${suffix} Yam` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      label: "Yam",
      weightGrams: 25000,
      wholesaleCostPence: 4000,
      purchaseThresholdGrams: opts.threshold,
      stockAt3pl: opts.stockAt3pl ?? 0,
      leadTimeDays: opts.leadTimeDays ?? 2,
    },
  });
  skuId = sku.id;

  const admin = await prisma.user.create({
    data: { email: `${TAG}-${suffix}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  adminId = admin.id;

  const basket = await prisma.basket.create({
    data: {
      cityId: city.id, skuId: sku.id, label: `${TAG} ${suffix}`, createdById: admin.id,
      tiers: { create: [{ label: "T", weightGrams: opts.tierGrams, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });

  const window = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate: DELIVERY, cutoffAt: CUTOFF, status: "open" },
  });

  for (let i = 0; i < opts.joiners; i++) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-${suffix}-${i}@test`, name: `U${i}`, passwordHash: "x" },
    });
    await prisma.order.create({
      data: {
        userId: u.id, basketId: basket.id, basketTierId: basket.tiers[0].id,
        deliveryWindowId: window.id, status: "committed",
        stripeCustomerId: "dev_cus_1", stripePaymentMethodId: "dev_pm_1",
        debitDate: CUTOFF, cancellationDeadline: CUTOFF,
        totalPence: 2200, deliveryAddress: "1 Test Street",
      },
    });
  }

  return { basketId: basket.id, windowId: window.id, skuId: sku.id };
}

afterAll(async () => {
  await prisma.order.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.demandSnapshot.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.purchaseOrder.deleteMany({ where: { sku: { product: { name: { startsWith: TAG } } } } });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("runCycles at the cutoff", () => {
  it("confirms, charges and raises a PO when demand clears the threshold", async () => {
    const { basketId, windowId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.confirmed).toBe(1);
    expect(result.charged).toBe(12);

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("locked");

    const snap = await prisma.demandSnapshot.findFirstOrThrow({ where: { basketId, windowId } });
    expect(snap.outcome).toBe("confirmed");
    expect(snap.demandedGramsAtDecision).toBe(120000);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "paid")).toBe(true);
    expect(orders.every((o) => o.stripePaymentIntentId !== null)).toBe(true);

    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { skuId, windowId } });
    expect(po.quantityGrams).toBe(120000);
    expect(po.status).toBe("pending");
  });

  it("fails the cycle below the threshold and charges nobody", async () => {
    const { basketId, windowId } = await scenario({
      tierGrams: 2000, joiners: 3, threshold: 100000,
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const snap = await prisma.demandSnapshot.findFirstOrThrow({ where: { basketId, windowId } });
    expect(snap.outcome).toBe("failed");

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "cancelled")).toBe(true);
    expect(orders.every((o) => o.paymentAttemptedAt === null)).toBe(true);
  });

  it("fails without charging when supply is not feasible", async () => {
    const { basketId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
      stockAt3pl: 0, leadTimeDays: 30,
    });

    await runCycles(AT_CUTOFF);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "cancelled")).toBe(true);
    expect(orders.every((o) => o.paymentAttemptedAt === null)).toBe(true);
  });

  it("raises no PO when held stock covers demand", async () => {
    const { basketId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000, stockAt3pl: 200000, leadTimeDays: 30,
    });

    await runCycles(AT_CUTOFF);

    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "paid")).toBe(true);
    expect(await prisma.purchaseOrder.count({ where: { skuId } })).toBe(0);

    // Stock is not moved by the decision itself.
    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
    expect(sku.stockAt3pl).toBe(200000);
  });

  it("is idempotent — a second run charges nobody twice and adds no PO", async () => {
    const { basketId, skuId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    await runCycles(AT_CUTOFF);
    const intents = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);

    const second = await runCycles(AT_CUTOFF);
    expect(second.confirmed).toBe(0);
    expect(second.charged).toBe(0);
    expect(await prisma.purchaseOrder.count({ where: { skuId } })).toBe(1);

    const after = (await prisma.order.findMany({ where: { basketId } }))
      .map((o) => o.stripePaymentIntentId);
    expect(after).toEqual(intents);
  });

  it("does nothing before the cutoff", async () => {
    const { basketId, windowId } = await scenario({
      tierGrams: 10000, joiners: 12, threshold: 100000,
    });

    await runCycles(new Date("2026-11-17T08:00:00Z"));

    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("open");
    const orders = await prisma.order.findMany({ where: { basketId } });
    expect(orders.every((o) => o.status === "committed")).toBe(true);
  });
});

describe("runCycles payment retries", () => {
  it("releases an order after the maximum retries", async () => {
    const { basketId } = await scenario({ tierGrams: 10000, joiners: 1, threshold: 100000 });
    const order = await prisma.order.findFirstOrThrow({ where: { basketId } });
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "payment_failed", paymentRetryCount: 3, paymentAttemptedAt: new Date() },
    });

    const result = await runCycles(AT_CUTOFF);
    expect(result.released).toBe(1);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("cancelled");
  });
});

describe("runCycles advance", () => {
  it("marks a window dispatched once its delivery date has passed", async () => {
    const { windowId } = await scenario({ tierGrams: 10000, joiners: 1, threshold: 1 });
    await runCycles(new Date("2026-11-22T08:00:00Z"));
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    expect(win.status).toBe("dispatched");
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run src/lib/cycle-run.integration.test.ts`
Expected: FAIL — cannot resolve `./cycle-run`.

- [ ] **Step 4: Implement**

Create `src/lib/cycle-run.ts`:

```ts
import "server-only";
import { prisma } from "./prisma";
import { MAX_PAYMENT_RETRIES } from "./constants";
import { ensureOpenWindows } from "./windows";
import { demandedGrams } from "./demand";
import { decideCycle } from "./cutoff";
import { chargeOrder } from "./payments";

// The daily 08:00 UTC run. 08:00 is not arbitrary: it is the hour every window's
// cutoff falls at, so the cutoff and the charge are the same moment.
//
// Order matters. Each window is locked, then decided on committed demand, and
// only a confirmed cycle charges anybody — so a basket that fails costs its
// joiners nothing. Every step is idempotent: reruns act only on rows still in
// the status they expect.

export type CycleRunResult = {
  windowsCreated: number;
  windowsLocked: number;
  confirmed: number;
  failed: number;
  charged: number;
  chargeFailures: number;
  released: number;
};

export async function runCycles(now: Date = new Date()): Promise<CycleRunResult> {
  const result: CycleRunResult = {
    windowsCreated: 0, windowsLocked: 0, confirmed: 0, failed: 0,
    charged: 0, chargeFailures: 0, released: 0,
  };

  // 1. Advance: close out delivered windows, then top up the open ones.
  //
  // `open` is included deliberately. If the cron missed a day, a window could
  // sit open past its own delivery date — and charging cards for a delivery
  // that has already been and gone would be worse than leaving its orders
  // uncharged for an admin to look at. A past delivery date ends the cycle
  // whatever state it was in, and step 2 then skips it.
  await prisma.deliveryWindow.updateMany({
    where: { status: { in: ["open", "locked"] }, deliveryDate: { lte: now } },
    data: { status: "dispatched" },
  });
  result.windowsCreated = (await ensureOpenWindows(now)).created;

  // 2. Cutoff: every open window whose moment has come.
  const due = await prisma.deliveryWindow.findMany({
    where: { status: "open", cutoffAt: { lte: now } },
    include: { city: true },
  });

  for (const window of due) {
    await prisma.deliveryWindow.update({
      where: { id: window.id },
      data: { status: "locked" },
    });
    result.windowsLocked++;

    // Every basket in this city that anyone actually joined this cycle.
    const baskets = await prisma.basket.findMany({
      where: { cityId: window.cityId, orders: { some: { deliveryWindowId: window.id } } },
      include: { sku: true },
    });

    for (const basket of baskets) {
      const demanded = await demandedGrams(basket.id, window.id);
      const decision = decideCycle(
        demanded,
        {
          stockAt3pl: basket.sku.stockAt3pl,
          leadTimeDays: basket.sku.leadTimeDays,
          purchaseThresholdGrams: basket.sku.purchaseThresholdGrams,
        },
        window.city.cutoffDays
      );

      await prisma.demandSnapshot.upsert({
        where: { basketId_windowId: { basketId: basket.id, windowId: window.id } },
        create: {
          basketId: basket.id, windowId: window.id,
          outcome: decision.outcome, decidedAt: now, demandedGramsAtDecision: demanded,
        },
        update: {
          outcome: decision.outcome, decidedAt: now, demandedGramsAtDecision: demanded,
        },
      });

      if (decision.outcome === "failed") {
        // Nobody is charged. Release every committed order untouched by Stripe.
        const released = await prisma.order.updateMany({
          where: { basketId: basket.id, deliveryWindowId: window.id, status: "committed" },
          data: { status: "cancelled" },
        });
        result.failed++;
        result.released += released.count;
        continue;
      }

      result.confirmed++;

      // Charge only now that the cycle is going ahead.
      const orders = await prisma.order.findMany({
        where: { basketId: basket.id, deliveryWindowId: window.id, status: "committed" },
      });
      for (const order of orders) {
        const charge = await attemptCharge(order.id, now);
        if (charge) result.charged++;
        else result.chargeFailures++;
      }

      if (decision.purchaseGrams > 0) {
        // Cost is per bulk unit, so round up to whole units of the SKU.
        const units = Math.ceil(decision.purchaseGrams / basket.sku.weightGrams);
        await prisma.purchaseOrder.create({
          data: {
            skuId: basket.sku.id,
            windowId: window.id,
            quantityGrams: decision.purchaseGrams,
            totalCostPence: units * basket.sku.wholesaleCostPence,
          },
        });
      }
    }
  }

  // 3. Retry failed charges, and release orders that have exhausted them.
  const failed = await prisma.order.findMany({
    where: { status: "payment_failed" },
  });
  for (const order of failed) {
    if (order.paymentRetryCount >= MAX_PAYMENT_RETRIES) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
      result.released++;
      continue;
    }
    const charge = await attemptCharge(order.id, now);
    if (charge) result.charged++;
    else result.chargeFailures++;
  }

  return result;
}

// Charge one order, moving it through payment_pending so a concurrent run
// cannot pick it up twice. Returns whether the charge succeeded.
async function attemptCharge(orderId: string, now: Date): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ["committed", "payment_failed"] } },
    data: { status: "payment_pending" },
  });
  if (claimed.count === 0) return false; // another run already has it

  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (!order.stripeCustomerId || !order.stripePaymentMethodId) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "payment_failed",
        paymentAttemptedAt: now,
        paymentRetryCount: { increment: 1 },
      },
    });
    return false;
  }

  const charge = await chargeOrder({
    amountPence: order.totalPence,
    customerId: order.stripeCustomerId,
    paymentMethodId: order.stripePaymentMethodId,
  });

  if (charge.ok) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "paid",
        stripePaymentIntentId: charge.paymentIntentId,
        paymentAttemptedAt: now,
      },
    });
    return true;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "payment_failed",
      paymentAttemptedAt: now,
      paymentRetryCount: { increment: 1 },
    },
  });
  return false;
}
```

- [ ] **Step 5: Add the cron route**

Create `src/app/api/cron/cycles/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { runCycles } from "@/lib/cycle-run";

// The daily cutoff run. Protect with CRON_SECRET and call at 08:00 UTC with
// either:
//   Authorization: Bearer <CRON_SECRET>   or   ?key=<CRON_SECRET>
// Supports GET and POST so it's easy to wire from any scheduler.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const key = req.nextUrl.searchParams.get("key");
  const authorized = auth === `Bearer ${secret}` || key === secret;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCycles();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
```

Replace `vercel.json` with:

```json
{
  "crons": [
    {
      "path": "/api/cron/cycles",
      "schedule": "0 8 * * *"
    }
  ]
}
```

- [ ] **Step 6: Run to confirm they pass**

Run: `npx vitest run src/lib/cycle-run.integration.test.ts`
Expected: PASS, 8 cases.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cycle-run.ts src/app/api/cron/cycles/route.ts vercel.json vitest.config.ts src/lib/cycle-run.integration.test.ts
git commit -m "feat: cutoff-day cycle cron

Locks each due window, decides every basket on committed demand and
supply feasibility, and charges only the cycles that confirm. A failed
cycle releases its orders with no charge attempted. Runs 08:00 UTC, the
hour every cutoff falls at."
```

---

### Task 9: Admin refund

The backstop for supply that was feasible at cutoff and then fell through.

**Files:**
- Create: `src/lib/refunds.ts`
- Test: `src/lib/refunds.integration.test.ts`

**Interfaces:**
- Consumes: `refundPaymentIntent` from `payments.ts`.
- Produces:
  - `refundOrder(orderId: string): Promise<void>`
  - `refundWindow(windowId: string): Promise<{ refunded: number }>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/refunds.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "./prisma";
import { refundOrder, refundWindow } from "./refunds";
import { demandedGrams } from "./demand";
import { cutoffAtFor } from "./cycles";

vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

const TAG = "ZZTEST_REFUND_" + Date.now();
let basketId = "";
let windowId = "";
let cityId = "";
let paidOrderId = "";

beforeAll(async () => {
  const city = await prisma.city.create({
    data: { name: `${TAG} City`, slug: `${TAG}-city`.toLowerCase(), anchorDate: new Date("2026-09-05T00:00:00Z"), active: false },
  });
  cityId = city.id;
  const product = await prisma.product.create({ data: { name: `${TAG} Yam` } });
  const sku = await prisma.sku.create({
    data: { productId: product.id, label: "Yam", weightGrams: 25000, wholesaleCostPence: 4000, purchaseThresholdGrams: 1 },
  });
  const admin = await prisma.user.create({
    data: { email: `${TAG}-ops@test`, name: "Ops", passwordHash: "x", role: "operator" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId, skuId: sku.id, label: `${TAG} B`, createdById: admin.id,
      tiers: { create: [{ label: "T", weightGrams: 5000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  basketId = basket.id;

  const deliveryDate = new Date("2026-11-21T00:00:00Z");
  const win = await prisma.deliveryWindow.create({
    data: { cityId, deliveryDate, cutoffAt: cutoffAtFor(deliveryDate, 3), status: "locked" },
  });
  windowId = win.id;

  for (let i = 0; i < 3; i++) {
    const u = await prisma.user.create({
      data: { email: `${TAG}-${i}@test`, name: `U${i}`, passwordHash: "x" },
    });
    const o = await prisma.order.create({
      data: {
        userId: u.id, basketId, basketTierId: basket.tiers[0].id, deliveryWindowId: windowId,
        status: "paid", stripePaymentIntentId: `dev_pi_${i}`,
        debitDate: win.cutoffAt, cancellationDeadline: win.cutoffAt,
        totalPence: 2200, deliveryAddress: "1 Test Street",
      },
    });
    if (i === 0) paidOrderId = o.id;
  }
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

describe("refundOrder", () => {
  it("marks a paid order refunded", async () => {
    await refundOrder(paidOrderId);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: paidOrderId } });
    expect(after.status).toBe("refunded");
  });

  it("removes the order from demand", async () => {
    // Two paid orders remain at 5000g each.
    expect(await demandedGrams(basketId, windowId)).toBe(10000);
  });

  it("refuses an order that was never charged", async () => {
    const win = await prisma.deliveryWindow.findUniqueOrThrow({ where: { id: windowId } });
    const tier = await prisma.basketTier.findFirstOrThrow({ where: { basketId } });
    const fresh = await prisma.user.create({
      data: { email: `${TAG}-fresh@test`, name: "F", passwordHash: "x" },
    });
    const uncharged = await prisma.order.create({
      data: {
        userId: fresh.id, basketId, basketTierId: tier.id, deliveryWindowId: windowId,
        status: "committed", debitDate: win.cutoffAt, cancellationDeadline: win.cutoffAt,
        totalPence: 2200, deliveryAddress: "1 Test Street",
      },
    });
    await expect(refundOrder(uncharged.id)).rejects.toThrow(/not been charged/i);
  });
});

describe("refundWindow", () => {
  it("refunds every remaining paid order in the window", async () => {
    const result = await refundWindow(windowId);
    expect(result.refunded).toBe(2);
    const paid = await prisma.order.count({ where: { deliveryWindowId: windowId, status: "paid" } });
    expect(paid).toBe(0);
  });

  it("is idempotent — a second call refunds nothing", async () => {
    expect((await refundWindow(windowId)).refunded).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/lib/refunds.integration.test.ts`
Expected: FAIL — cannot resolve `./refunds`.

- [ ] **Step 3: Implement**

Create `src/lib/refunds.ts`:

```ts
import "server-only";
import { prisma } from "./prisma";
import { refundPaymentIntent } from "./payments";

// The backstop for supply that looked feasible at the cutoff and then fell
// through. Customers are charged before the supplier confirms, so this is the
// path that gives their money back.
//
// A refunded order leaves demand aggregation, so a later view of the cycle
// reflects what was actually delivered.

export async function refundOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (order.status !== "paid") {
    throw new Error("This order has not been charged, so there is nothing to refund.");
  }
  if (!order.stripePaymentIntentId) {
    throw new Error("This order has no payment to refund.");
  }

  await refundPaymentIntent(order.stripePaymentIntentId);
  await prisma.order.update({ where: { id: orderId }, data: { status: "refunded" } });
}

// Refund every charged order in a window — the whole-cycle version, used when a
// delivery is pulled after cards were taken.
export async function refundWindow(windowId: string): Promise<{ refunded: number }> {
  const orders = await prisma.order.findMany({
    where: { deliveryWindowId: windowId, status: "paid" },
    select: { id: true },
  });

  for (const order of orders) await refundOrder(order.id);
  return { refunded: orders.length };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run src/lib/refunds.integration.test.ts`
Expected: PASS, 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refunds.ts src/lib/refunds.integration.test.ts
git commit -m "feat: admin refund for a charged order or a whole window

The backstop for supply that fell through after cards were taken. A
refunded order drops out of demand aggregation."
```

---

### Task 10: Seeds

**Files:**
- Modify: `prisma/seed.ts` (full rewrite)
- Modify: `scripts/seed-scenario.ts` (full rewrite)

**Interfaces:**
- Consumes: `CITIES`, `DEFAULT_CADENCE_DAYS`, `DEFAULT_CUTOFF_DAYS` from constants; `cutoffAtFor`, `upcomingDeliveryDates` from `cycles.ts`.
- Produces: a database with the eight cities, three dry products, four baskets and open windows — enough for Plan 2's screens to render.

- [ ] **Step 1: Rewrite the seed**

Replace `prisma/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CITIES } from "../src/lib/constants";
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

  // The eight cities, each on a fortnightly schedule.
  for (const [i, name] of CITIES.entries()) {
    const slug = name.toLowerCase();
    await prisma.city.upsert({
      where: { slug },
      update: {},
      create: { name, slug, anchorDate: anchorFor(i) },
    });
  }

  // Launch catalogue: dry goods only, sourced in the UK, so leadTimeDays fits
  // inside the 3-day cutoff window.
  const catalogue = [
    {
      name: "White Yam",
      description: "Ambient-stable white yam, bought by the 25 kg crate.",
      weightGrams: 25000,
      wholesaleCostPence: 4200,
      purchaseThresholdGrams: 100000,
    },
    {
      name: "Egusi",
      description: "Ground melon seed, by the 10 kg sack.",
      weightGrams: 10000,
      wholesaleCostPence: 5500,
      purchaseThresholdGrams: 40000,
    },
    {
      name: "Crayfish",
      description: "Dried ground crayfish, by the 5 kg box.",
      weightGrams: 5000,
      wholesaleCostPence: 6800,
      purchaseThresholdGrams: 20000,
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
          purchaseThresholdGrams: item.purchaseThresholdGrams,
          leadTimeDays: 2, // UK-held stock
          reorderPoint: item.weightGrams,
        },
      }));
    skus[item.name] = sku.id;
  }

  // The v3.0 tier ladder: bigger tiers are cheaper per kg.
  const TIERS = [
    { label: "Small (2 kg)", weightGrams: 2000, pricePence: 950, displayOrder: 1 },
    { label: "Medium (5 kg)", weightGrams: 5000, pricePence: 2200, displayOrder: 2 },
    { label: "Large (10 kg)", weightGrams: 10000, pricePence: 4000, displayOrder: 3 },
    { label: "Family (20 kg)", weightGrams: 20000, pricePence: 7200, displayOrder: 4 },
  ];

  // Yam appears in two cities so the city-isolation rule is visible: each has
  // its own demand and each succeeds or fails on its own.
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
```

- [ ] **Step 2: Rewrite the scenario script**

Replace `scripts/seed-scenario.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Adds joined orders at varying demand levels on top of `npm run db:seed`, so
// every demand-bar state is reachable by hand: a nearly-full basket, a cold one
// under 20%, one already confirmed, and one already failed.
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
        email, name: `Scenario ${tag}`, passwordHash,
        addrLine1: "1 Scenario Street", addrCity: "Sheffield", postcode: "S1 1AA",
      },
    });
  }

  async function join(basketIndex: number, tierIndex: number, tag: string, status: string) {
    const basket = baskets[basketIndex];
    const window = await prisma.deliveryWindow.findFirst({
      where: { cityId: basket.cityId, status: "open" },
      orderBy: { deliveryDate: "asc" },
    });
    if (!window) return;

    const user = await member(`${tag}-${basketIndex}`);
    const tier = basket.tiers[tierIndex];

    await prisma.order.upsert({
      where: {
        userId_basketId_deliveryWindowId: {
          userId: user.id, basketId: basket.id, deliveryWindowId: window.id,
        },
      },
      update: { status },
      create: {
        userId: user.id, basketId: basket.id, basketTierId: tier.id,
        deliveryWindowId: window.id, status,
        stripeCustomerId: "dev_cus_scenario", stripePaymentMethodId: "dev_pm_scenario",
        debitDate: window.cutoffAt, cancellationDeadline: window.cutoffAt,
        totalPence: tier.pricePence,
        deliveryAddress: "1 Scenario Street, Sheffield S1 1AA",
      },
    });
  }

  // Basket 0 (Yam Sheffield): nearly full — several Family tiers.
  for (const tag of ["a", "b", "c", "d"]) await join(0, 3, tag, "committed");

  // Basket 1 (Yam Birmingham): cold, under 20% — one Small tier. Same food as
  // basket 0, different city, so the isolation rule is visible side by side.
  await join(1, 0, "a", "committed");

  // Basket 2 (Egusi Manchester): held stock, so a confirmed cycle needs no PO.
  await prisma.sku.update({
    where: { id: baskets[2].skuId },
    data: { stockAt3pl: 60000 },
  });
  for (const tag of ["a", "b", "c"]) await join(2, 2, tag, "committed");

  // Basket 3 (Crayfish London): a long lead time with no stock — this cycle
  // fails the feasibility check at cutoff and charges nobody.
  await prisma.sku.update({
    where: { id: baskets[3].skuId },
    data: { leadTimeDays: 30, stockAt3pl: 0 },
  });
  for (const tag of ["a", "b", "c", "d", "e"]) await join(3, 2, tag, "committed");

  console.log("Scenario seeded. Run the cron to see cycles decide:");
  console.log("  curl 'http://localhost:3000/api/cron/cycles?key=$CRON_SECRET'");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run the seeds**

Run: `npm run db:push && npm run db:seed && npx tsx scripts/seed-scenario.ts`
Expected: both complete. The seed logs `Seeded 8 cities, 3 products, 4 baskets and their delivery windows.`

- [ ] **Step 4: Verify the data**

Run:

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  console.log('cities', await p.city.count());
  console.log('baskets', await p.basket.count());
  console.log('tiers', await p.basketTier.count());
  console.log('open windows', await p.deliveryWindow.count({ where: { status: 'open' } }));
  console.log('orders', await p.order.count());
  await p.\$disconnect();
})();
"
```

Expected: `cities 8`, `baskets 4`, `tiers 16`, `open windows 16`, `orders 13`.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts scripts/seed-scenario.ts
git commit -m "feat: seed cities, catalogue, baskets and demand scenarios

Yam appears in Sheffield and Birmingham so city isolation is visible side
by side. The scenario script sets up a nearly-full basket, a cold one, one
fulfillable from held stock, and one that fails the feasibility check."
```

---

### Task 11: Full-suite verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a green branch ready for Plan 2.

- [ ] **Step 1: Run the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all four pass. `npm test` reports 9 files — `money.test.ts`, `cycles.test.ts`, `cutoff.test.ts`, `payments.test.ts`, `schema.integration.test.ts`, `demand.integration.test.ts`, `joins.integration.test.ts`, `cycle-run.integration.test.ts`, `refunds.integration.test.ts` — running serially, since Task 8 disabled file parallelism.

If anything fails, fix it before continuing — do not proceed to Plan 2 on a red branch.

- [ ] **Step 2: Exercise the cron end to end**

Run:

```bash
CRON_SECRET=devsecret npm run dev &
sleep 5
curl -s "http://localhost:3000/api/cron/cycles?key=devsecret" | head -20
```

Expected: JSON with `ok: true` and the counters. With freshly seeded data whose cutoffs are still in the future, `windowsLocked` is 0 — that is correct, not a failure. To see a cycle decide, move a window's cutoff into the past:

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const w = await p.deliveryWindow.findFirstOrThrow({ where: { status: 'open' }, orderBy: { deliveryDate: 'asc' } });
  await p.deliveryWindow.update({ where: { id: w.id }, data: { cutoffAt: new Date(Date.now() - 3600_000) } });
  await p.\$disconnect();
})();
"
curl -s "http://localhost:3000/api/cron/cycles?key=devsecret"
```

Expected: `windowsLocked` at least 1, and `confirmed` or `failed` non-zero.

Stop the dev server when done.

- [ ] **Step 3: Update the README**

In `README.md`, replace the "The flow" section with:

```markdown
## The flow

1. **Operator** sets each city's delivery schedule at `/operator/cities` — a
   fortnightly date series and how many days before delivery joining closes
   (default 3).
2. **Operator** curates products and SKUs, then opens a **basket** for one food
   in one city, with 2–4 quantity tiers (e.g. 2 kg £9.50 … 20 kg £72).
3. A **member** browses baskets in their city and **joins** one, choosing a
   tier. Their card is saved but not charged.
4. Three days before delivery the basket **closes**. Demand is measured against
   the SKU's threshold and checked against available supply.
5. If the cycle **confirms**, every saved card is charged and a purchase order
   goes to the supplier. If it **fails**, nobody is charged at all.
6. Goods are fulfilled from stock at the 3PL or bought in, and delivered on the
   city's delivery date.
```

Replace the "Auto-expiry (scheduled)" section with:

```markdown
## Delivery cycles (scheduled)

`GET|POST /api/cron/cycles` (guarded by `CRON_SECRET`) runs daily at **08:00
UTC** — the hour every window's cutoff falls at, because the cutoff and the
charge are the same moment. It advances delivered windows, keeps two windows
open per city, locks windows whose cutoff has passed, decides each basket's
cycle, charges the cycles that confirm, and retries failed payments. It runs on
**Vercel Cron** (configured in `vercel.json`).
```

Replace the "What's covered" bullets with:

```markdown
- Accounts with email verification, password reset, rate-limited login, and an
  account page (name, **delivery address**, password).
- City delivery schedules; an operator-curated catalogue of products and SKUs;
  admin-created baskets with 2–4 quantity tiers priced per kg.
- Joining saves a card without charging it; the cutoff cron decides each cycle
  on demand and supply, then charges only the cycles that confirm.
- Free cancellation until the cutoff, automatic payment retries, and operator
  refunds for a single order or a whole delivery.
```

In the Scripts table, change the `npm test` row's purpose from
"Vitest (merge engine + DB integration)" to
"Vitest (cycle logic + DB integration)".

Finally, update the intro paragraph: the app is no longer a merge engine.
Replace the first paragraph with:

```markdown
A food aggregation & bulk-buying **PWA** for the UK. Each city runs a delivery
twice a month; members **join** a basket for a food in their city, choosing a
quantity tier. Three days before delivery the basket closes — if enough demand
gathered, every saved card is charged and the order goes to the supplier. If it
didn't, nobody pays a penny.
```

- [ ] **Step 4: Final verification**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe the platform-scheduled basket flow

Replaces the merge-engine walkthrough and the auto-expiry section with
the city delivery cycle and its 08:00 UTC cron."
```

---

## What Plan 2 covers

Written after this plan lands, against the real signatures above:

- **Admin (spec §8):** cities and schedules, products/SKUs, basket CRUD with inline tiers, pause/archive, basket detail by window, demand dashboard, purchase orders including hand-raised replenishment buys, and the refund screens over `refundOrder`/`refundWindow`.
- **User (spec §9):** `/`, `/baskets` with the city filter, `/baskets/:id`, the multi-step join flow over `joinBasket`, `/orders` and `/orders/:id` with cancellation over `cancelOrder`, and the demand bar in both variants.
- **Emails (spec §14):** join confirmation, cycle confirmed, cycle cancelled, charge success, charge failure, basket paused, refund issued.
- **Copy (spec §9.2):** the v3.0 messaging table and the mandatory v2.1 §6 disclosure block at the confirm step.
