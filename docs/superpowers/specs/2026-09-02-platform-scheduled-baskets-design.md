# Platform-Scheduled Baskets — Design

Date: 2026-09-02 (revision 2)
Status: Approved for planning
Supersedes: the user-organised basket model currently in `main`

Revision 2 replaces the per-basket delivery schedule with a city-level one and
moves the card charge from 24 hours before delivery to the join cutoff. See §5.

## 1. Context

Opher currently implements a v1.0 model: members create baskets for a commodity,
invite others, claim portions, and a merge engine pools part-filled baskets into
whole bulk units. Payment is collected at order time via Stripe Checkout.

Three handoff documents describe the target model:

| Document | Version | Authority |
| --- | --- | --- |
| FoodShare Claude Code Handoff | v2.0 | Backend architecture: Product, SKU, DeliveryWindow, DemandSnapshot, PurchaseOrder |
| Payment Model Addendum | v2.1 | Deferred payment, Order status enum, Stripe SetupIntent, `debit_date` rules |
| Basket Addendum | v3.0 | Basket + BasketTier, join flow, admin panel, user UI, demand signal |

v3.0 takes precedence on conflicts; v2.1 takes precedence over v2.0 on payment.
Neither v2.0 nor v2.1 was ever implemented, so this design covers all three at
once rather than treating v3.0 as an increment. Where this document departs from
all three, §5 explains why.

**Model statement.** Each city runs a delivery twice a month. The platform
pre-schedules baskets (city × food) against those dates. Users browse, choose a
quantity tier, and join. Joining saves a card and creates a `committed` order
without charging it. Three days before delivery the basket closes: demand is
measured, and if it clears the threshold every committed card is charged and the
importer order goes out. If it doesn't clear, the cycle is cancelled and nobody
is charged.

## 2. Scope

**In:** City with its delivery schedule; Product + SKU; Basket + BasketTier;
city-scoped DeliveryWindow; DemandSnapshot and the purchase trigger;
PurchaseOrder, including hand-raised replenishment stock buys; Order rebuilt on
Stripe SetupIntent with deferred charging and cancellation; the cutoff-day cron;
admin basket, schedule, demand and refund surfaces; the user
browse/detail/join/orders screens; v3.0 copy; removal of the v1.0 group-buying
machinery.

**Out (later milestones):** Hubo CSV manifest export and the Phase 2 3PL API;
*automated* reorder alerts (the manual replenishment PO is in — see §5.3); the
§7.3 analytics dashboard; referral tracking (schema field only, unused);
`fresh` category products; all email beyond join confirmation, cycle confirmed,
cycle cancelled, charge success, charge failure and refund.

## 3. Conflicts between the documents, and how they are resolved

| # | Conflict | Resolution |
| --- | --- | --- |
| A | v2.0 `SKU` carries `label`/`weight_kg`/`price_gbp` and is the sellable variant. v3.0 `BasketTier` carries the same three fields and takes over the sell side. | SKU is **supply-side only**: wholesale cost, purchase threshold, stock at 3PL, reorder point. BasketTier is what a customer buys. SKU has no customer-facing price. |
| B | v2.0 `purchase_threshold_units` is "units of demand"; v3.0 §5.2 says KG. | Weight-based, stored as `purchaseThresholdGrams`. |
| C | v2.0 delivery windows are platform-wide fixed biweekly dates; v3.0 baskets each carry their own recurrence and `next_delivery_date`. | Neither. Windows are **city-scoped**: each city runs a fortnightly delivery that every basket in that city shares. This is closer to v2.0's fixed windows, partitioned by city, and is the point of clustering cities — one delivery run per city per cycle carrying every food. Baskets therefore carry no schedule of their own. |
| D | v2.0 §4 specifies a cart and checkout; v3.0 §10 removes the cart — join is the order. | No cart. Never built. |
| E | v2.0 collects payment immediately; v2.1 and v3.0 defer it to 24 hours before delivery. | Deferred, but to the **join cutoff**, not to delivery minus one day. See §5. |
| F | v2.0 §5 strips all group language ("no visible group mechanic", "Join a basket" → "Order at wholesale price"). v3.0 §8.3 restores it ("Join a basket", "Community delivery", a collective demand bar). | v3.0 wins. The group mechanic is visible, reframed from *coordination* (waiting on strangers) to *social proof* (a progress bar). **v2.0 §5's copy table is not applied at any point.** |
| G | v2.0 defines a stock-based fulfilment fallback (dispatch immediately if `stock_at_3pl` covers the order). | Retained in reduced form: stock at Hubo reduces the quantity on a PurchaseOrder, and suppresses it entirely when stock already covers demand. It does not change the delivery date, which is fixed by the city schedule. |
| H | Docs assume a separate `AdminUser` entity with separate auth. | The existing `User.role = "operator"` fills this role. No second auth system. |

## 4. Deviations from the documents

**4.1 Order creation is not webhook-driven.** v3.0 §6 step 5 creates the Order in
the `setup_intent.succeeded` handler. That races the confirmation screen — the
user is shown "You're in!" before the row exists, and a delayed webhook is
indistinguishable from a lost order. The Order is instead written when the join
request returns from Stripe.js confirmation; the webhook reconciles (fills
`stripePaymentMethodId` if absent, logs an orphaned SetupIntent) and is
idempotent on `stripeSetupIntentId`.

**4.2 Demand totals are computed, not stored.** v2.1 §4 and v3.0 §6 increment and
decrement `DemandSnapshot.total_units_ordered` on join and cancel. Two writers
with no transaction boundary silently drift, and this number drives real
purchase decisions. Totals are summed from orders on read. `DemandSnapshot`
persists only the outcome of the cutoff decision, which cannot be recomputed.

**4.3 The charge moves to the cutoff, and the 50% paid floor is deleted.** See §5.

## 5. Cycle timing — where this design departs from the documents

### 5.1 The problem in the documents

v2.1 §4 and v3.0 §5.2 gate the PurchaseOrder on:

```
total_units_ordered >= purchase_threshold_units
AND PAID_only_total >= purchase_threshold_units * 0.5
AND purchase_triggered == false
```

**As specified this can never fire in useful time.** Demand aggregates per
(basket, window). Orders in a window are charged at 08:00 UTC on
`deliveryDate − 1`, so none reaches `paid` until 24 hours before delivery — a
day *after* the 48-hour join cutoff has passed, and long after the purchase
decision needed making. The paid floor is only satisfiable once it is moot.

### 5.2 The resolution

The join cutoff and the charge become **the same moment**, three days before
delivery, and the decision is taken before the money moves:

```
D−3, 08:00 UTC     window locks — no further joins
                   ↓ per basket: sum committed demand vs SKU threshold
                   ├─ met     → charge every committed order → raise PO → notify admin
                   └─ not met → cancel the cycle's orders, notify joiners, no charge
D                  delivery
```

Three consequences, all improvements on the documented model:

1. **The paid floor is unnecessary and is removed.** It existed to estimate
   payment confidence while the answer was unknowable. Charging *after* the
   go/no-go decision makes confidence total. There is no `PURCHASE_PAID_FLOOR`
   setting.
2. **No refunds in the normal path.** Charging before knowing whether a basket
   fills would mean taking money for food that is never bought. Deciding first
   means a failed cycle costs the customer nothing.
3. **One deadline rather than two.** The documents give a customer a cutoff and
   a debit date three days apart. Here they are one date: "cancel free until the
   basket closes on Tuesday — we charge that morning."

### 5.3 Supply model

The PurchaseOrder raised at cutoff supplies **that same cycle**, leaving under
72 hours to get goods to Hubo for dispatch. That is workable because of a
deliberate launch constraint rather than an assumption: **the catalogue opens
with foodstuffs already held in the UK**, bought from domestic wholesale inside
the window. Nothing that needs importing is offered until it can be supplied
from stock.

Supply therefore reaches a cycle by one of two routes, and the second grows as
the business does:

1. **Buy to order.** Demand confirms at cutoff, a PurchaseOrder goes out, goods
   reach Hubo inside the three days. Viable only for SKUs whose lead time fits
   the window — which is what UK-held stock buys you.
2. **Fulfil from inventory.** Once a basket has proven demand over a few cycles,
   non-perishable stock is bought ahead and held at Hubo. Orders then draw that
   inventory down, and the cycle needs no purchase at all.

Route 2 is why `Product.category` (`dry` | `fresh`) exists: only `dry` goods can
be pre-bought and held. It is also why a manual replenishment PurchaseOrder is
in scope (§8) — pre-buying is how the model is meant to mature, not a later
nicety.

**Feasibility is checked before money moves.** A cycle confirms at cutoff only
if stock already covers the demand, or the SKU's lead time fits inside the
cutoff window. A basket that clears its demand threshold but can be supplied by
neither route **fails the cycle rather than charging** — the customer pays
nothing and is told to join the next one. This keeps the exposure created by
charging ahead of importer confirmation small.

The residual exposure — supply that was feasible at cutoff and then fell through
— is handled by the admin **refund path** (§8).

## 6. Data model

Conventions follow the existing schema: `cuid()` primary keys, statuses as plain
lowercase strings defined in `src/lib/constants.ts` rather than DB enums (for
provider portability, per the schema header), money as integer pence.

**Weights are integer grams.** Threshold sums drive purchase decisions and must
not accumulate float error — the same reasoning that makes money pence. `2 kg` is
stored as `2000` and displayed as kg.

### New models

**City** — `id`, `name`, `slug`, `active`, `cadenceDays` (default 14),
`anchorDate`, `cutoffDays` (default 3), `createdAt`. Carries the delivery
schedule for every basket in the city (conflict C). Delivery dates are generated
from `anchorDate` in steps of `cadenceDays`.

**Product** — `id`, `name`, `description`, `imageUrl?`, `category`
(`dry` | `fresh`), `active`, `createdAt`.

**Sku** — `id`, `productId`, `label`, `weightGrams`, `wholesaleCostPence`,
`purchaseThresholdGrams`, `leadTimeDays`, `stockAt3pl`, `reorderPoint`,
`active`, `createdAt`. Supply-side only; no customer-facing price (conflict A).

`leadTimeDays` is days from raising a PurchaseOrder to goods being at Hubo. It
is the field the cutoff feasibility check reads (§5.3): a SKU whose lead time
exceeds the city's `cutoffDays` can only be fulfilled from stock. UK-held goods
sit at 1–2 days; imported lines at weeks.

**Basket** — `id`, `cityId`, `skuId`, `label`, `status` (`open` | `paused` |
`archived`), `minJoiners`, `createdById`, `createdAt`. Unique on
(`cityId`, `skuId`) among non-archived rows — one basket per food per city.

Baskets carry **no schedule**: recurrence, cutoff and delivery dates all live on
`City`. A basket has no `locked` status either; locking is a property of the
window, and a basket spans many windows.

`minJoiners` is stored and displayed to the admin but gates nothing: v3.0 §3.1
is explicit that it is a soft marketing floor and that the threshold alone
governs purchasing. No code branches on it.

**BasketTier** — `id`, `basketId`, `label`, `weightGrams`, `pricePence`,
`active`, `displayOrder`. Price per kg is computed for display, never stored.
2–4 active tiers per basket, enforced in app code.

**DeliveryWindow** — `id`, `cityId`, `deliveryDate`, `cutoffAt`, `status`
(`open` | `locked` | `dispatched` | `cancelled`), `notes`, `createdAt`. Unique
on (`cityId`, `deliveryDate`).

`cutoffAt` is **08:00 UTC on `deliveryDate − city.cutoffDays`**. Defining it at
a fixed hour rather than as a rolling 72 hours is what lets a single daily cron
own the cutoff, and makes the moment predictable for customers.

**DemandSnapshot** — `id`, `basketId`, `windowId`, `outcome`
(`pending` | `confirmed` | `failed`), `decidedAt?`, `demandedGramsAtDecision?`.
Unique on (`basketId`, `windowId`). Records the cutoff decision; running totals
are computed (§4.2).

**PurchaseOrder** — `id`, `skuId`, `windowId?`, `quantityGrams`,
`totalCostPence`, `status` (`pending` | `sent` | `confirmed` |
`received_at_3pl` | `failed`), `importerRef?`, `createdAt`. `failed` exists for
the §5.3 case where a supplier cannot deliver after customers were charged.

`windowId` is null on a **replenishment** PO — stock bought ahead of demand
rather than against a specific cycle (§5.3 route 2). A PO raised by the cutoff
cron always carries its window.

### Rewritten

**Order** — `id`, `userId`, `basketId`, `basketTierId`, `deliveryWindowId`,
`status` (`committed` | `payment_pending` | `paid` | `payment_failed` |
`dispatching` | `delivered` | `cancelled` | `refunded`), `stripeCustomerId`,
`stripeSetupIntentId`, `stripePaymentMethodId`, `stripePaymentIntentId?`,
`debitDate`, `cancellationDeadline`, `paymentAttemptedAt?`, `paymentRetryCount`
(default 0), `totalPence`, `deliveryAddress` (snapshot at join), `utmSource?`,
`utmMedium?`, `utmCampaign?`, `referrerOrderId?`, `createdAt`.

`debitDate` and `cancellationDeadline` are both taken from the window's
`cutoffAt` — they are no longer independent dates. `refunded` is added to the
v2.1 enum for §5.3.

`totalPence` is copied from `basketTier.pricePence` at join so a later tier price
edit cannot retroactively change what a customer owes. `stripeSetupIntentId` is
unique, which is what makes the reconciling webhook of §4.1 idempotent.

### Kept

`User` (gains `stripeCustomerId?`), `VerificationToken`, `DeliveryEvent`
(re-pointed at the new `Order`), `Waitlist`.

### Removed

`Commodity`, `Basket.organiserId` and its relation, `PortionClaim`,
`DeliveryZone`, `Payment`. Payment state lives on `Order`; a separate row is
redundant once one order equals one payer.

### Cities seeded

London, Birmingham, Manchester, Leeds, Sheffield, Leicester, Bristol,
Nottingham — the eight that carry the bulk of the addressable market. Each is
seeded `active` with a fortnightly cadence and a staggered `anchorDate`, so
delivery runs do not all land on the same day.

## 7. Lifecycle

### 7.1 Window generation

Delivery dates for a city are `anchorDate + n × cadenceDays`. The cron maintains
the next two windows in `open` status ahead of the current one, so a customer can
always see and join the upcoming delivery and the one after it.

A window created with `cutoffAt` already in the past is created `locked` and
accepts no joins. This replaces v2.1's immediate-charge path for deliveries
≤ 1 day away: with the charge at the cutoff, there is no longer any interval in
which an order can exist uncharged past its own debit date, so that branch is
unreachable by construction rather than handled at runtime.

### 7.2 Status transitions

- Window `open` → `locked` at `cutoffAt`. No new joins.
- Window `locked` → `dispatched` on the delivery date.
- Window → `cancelled` by admin, cancelling and refunding its orders.
- Basket `open` → `paused` by admin: new joins stop, existing orders are
  retained, joiners are emailed. `paused` → `open` restores.
- Basket → `archived` by admin: it appears in no future windows. Orders already
  placed run to completion.

A paused or archived basket accepts no joins regardless of window status.

### 7.3 The cutoff-day cron

`/api/cron/expire` targets baskets and orders that no longer exist under this
model and is replaced by a single route reusing its `CRON_SECRET` guard and
GET/POST shape. Cron count stays at one, now at **08:00 UTC daily**, which is
the hour `cutoffAt` is defined at.

Every step is idempotent — the run must be safe to repeat — and each acts only
on rows in the status it expects.

1. **Advance.** Windows past their delivery date → `dispatched`. Generate new
   `open` windows to maintain two ahead per active city.
2. **Cutoff.** For each `open` window with `cutoffAt <= now`: set `locked`, then
   for each basket in that city holding orders in the window, sum committed
   grams against `sku.purchaseThresholdGrams`.
   - **Met, and supply is feasible** — snapshot `confirmed`. Move its orders
     `committed` → `payment_pending`, charge off-session, then `paid` or
     `payment_failed`. Where stock does not already cover demand, raise a
     `PurchaseOrder` for the shortfall. Notify admin. Email joiners that the
     delivery is confirmed.
   - **Met, but supply is not feasible** — snapshot `failed`, orders
     `cancelled`, **no charge attempted**. Email joiners. See the feasibility
     rule below.
   - **Not met** — snapshot `failed`. Its orders → `cancelled` with no charge
     attempted. Email joiners.

**Feasibility rule (§5.3).** Supply is feasible when
`sku.stockAt3pl >= demandedGrams` (fulfil from inventory, no PurchaseOrder) or
`sku.leadTimeDays <= city.cutoffDays` (buy to order for the shortfall). When
neither holds, the cycle fails rather than charging customers for food that
cannot arrive. This is checked *before* any charge is attempted.
3. **Retry.** `payment_failed` orders are retried once per daily run; on the
   third failure the order is `cancelled` and the customer notified.

Thresholds are evaluated **per basket**, so a city's yam basket can confirm in
the same window that its egusi basket fails. This extends v3.0 §5.3's city
isolation to food-level isolation within a city.

`stockAt3pl` is **not** decremented when a PurchaseOrder is raised — the
reduction above only sizes the order. Stock increments when the admin marks a
PurchaseOrder `received_at_3pl` and decrements when a window's orders move to
`dispatching`, so it always reflects goods physically at the warehouse.

### 7.4 Join

Route `/baskets/:id/join`, single page, no reloads: delivery address → tier
confirm → Stripe Elements → confirm.

1. Server action ensures a Stripe Customer for the user and creates a
   SetupIntent with `usage: "off_session"`; returns the client secret.
2. Stripe.js confirms; the payment method id comes back.
3. The Order is written (§4.1) against the city's next `open` window, with
   `debitDate` and `cancellationDeadline` both set from that window's
   `cutoffAt`, status `committed`.
4. UTM parameters present on the URL are stored on the Order.

Joining is refused if the window has locked between page load and submission.

**Dev fallback.** The existing no-Stripe-key path is preserved: with no
`STRIPE_SECRET_KEY`, joining stores a placeholder payment method and the cron
marks orders paid directly, keeping the flow clickable locally.

### 7.5 Cancellation

Permitted while `now < cancellationDeadline` and status is `committed`. Sets
`cancelled`, clears `stripePaymentMethodId` on the order (v2.1 §7, GDPR), and
emails confirmation. Because the deadline is the cutoff, the customer-facing
rule is simply: cancel any time before the basket closes.

Refused otherwise — and never permitted after a charge attempt, even a failed
one; the retry flow handles those. A charged order that must be unwound is an
admin refund (§8), not a customer cancellation.

The payment method is detached from the Stripe Customer **only if no other order
still depends on it**. A user with two committed joins shares one saved card, so
unconditionally detaching on the first cancellation would silently break the
charge for the second. Detach only when no remaining order for that user holds
the same `stripePaymentMethodId` in a chargeable status.

## 8. Admin surface

Extends the existing `/operator` shell; `requireOperator()` guards throughout.

| Screen | Contents |
| --- | --- |
| Cities | The eight cities: name, cadence, anchor date, cutoff days, active toggle. Editing the schedule regenerates future `open` windows; windows with orders against them are never moved. |
| Products / SKUs | Replaces `/operator/commodities`. Product CRUD; SKU CRUD with threshold, wholesale cost, stock, reorder point. |
| Basket list | Filter by city, product, status. Columns: city, food, next delivery, joiners, kg demanded, % of threshold, status. |
| Create basket | City dropdown, SKU dropdown. Label auto-generated as `"{Product} — {City}"` and editable. 2–4 tiers added inline. No schedule fields — the city owns those. |
| Edit basket | Label, tiers (add/disable). City and SKU are locked once any order exists against the basket. |
| Pause / archive | Pause emails existing joiners. Archive removes the basket from future windows. |
| Basket detail | Orders for a given basket × window: user, tier, status, debit date, payment state. |
| Demand dashboard | Every open window: kg demanded vs threshold, % filled, hours to cutoff. Sorted by urgency. |
| Purchase orders | List, confirm with supplier, log `importerRef`, advance status. Setting `received_at_3pl` increments `sku.stockAt3pl`. Setting `failed` surfaces the refund action below. |
| Raise replenishment PO | Create a PurchaseOrder against a SKU by hand, unattached to any window, to pre-buy non-perishable stock ahead of demand (§5.3 route 2). Shows current `stockAt3pl`, `reorderPoint` and recent demand per cycle to size it. This is how a proven basket moves from buy-to-order onto held inventory. |
| Refunds | Refund a charged order, or every charged order in a window, via Stripe. Sets `refunded` and emails the customer. Required by §5.3 — the path taken when the importer cannot supply after cards were charged. |

## 9. User surface

| Route | Contents |
| --- | --- |
| `/` | Hero: "Fresh African staples delivered to your door — join your local basket." CTA to `/baskets`. No login to browse. |
| `/baskets` | City filter across the 8 (from the user's saved city if set, else manual). Cards: photo, city, delivery date, tier price range, compact demand bar. Sorted by delivery date ascending. |
| `/baskets/:id` | Product info, tier selector with price per kg, delivery date, closing date, full demand bar, join CTA, "How it works" accordion. |
| `/baskets/:id/join` | The multi-step flow of §7.4. |
| `/orders` | Joined baskets: product, city, tier, delivery date, status badge, cancel button when before the cutoff. |
| `/orders/:id` | Full detail, payment status, cancel with deadline warning, delivery timeline. |

### 9.1 Demand bar

Progress is `demanded grams / sku.purchaseThresholdGrams`.

- Compact (browse card): coloured bar, "X% to delivery confirmed".
- Full (detail): bar plus "X kg joined · Y kg needed · closes [date]".
- Below 20% filled: suppress raw numbers, show "Be one of the first to join!"
- Confirmed at cutoff: green — "Delivery confirmed — we've ordered your food!"
- Basket paused: amber — "Temporarily paused — existing orders retained."
- Window locked: grey — "Joining closed — next delivery on [date]", linking to
  the next window.
- Cycle failed: grey — "This delivery didn't reach its minimum. Nobody was
  charged — join the next one on [date]."

### 9.2 Copy

v3.0 §8.3 governs. v2.0 §5 is not applied (conflict F). "Create a basket" → "Join
a basket"; "Your basket is empty" → "No baskets in your city yet — check back
soon"; "Add to basket" → "Join this basket"; "Checkout" → "Confirm your spot";
"Order placed" → "You're in! We'll charge your card on [cutoff date]"; "Group
buying" → "Community delivery"; "Minimum members needed" → "Building demand —
[X]% there".

The v2.1 §6 disclosure block is mandatory at the confirm step and its wording is
a compliance requirement, not a style choice. Adapted to the single deadline:

```
Delivery: Saturday 18 October
Your card will be charged on: Wednesday 15 October
Cancel free until then · If the basket doesn't fill, you pay nothing
```

## 10. Removals

Deleted with the model change: `src/lib/merge.ts`, `src/lib/merge-orders.ts` and
their tests (`merge.test.ts`, `merge-orders.integration.test.ts`,
`merge-zones.integration.test.ts`); `src/lib/expiry.ts` and
`expiry.integration.test.ts`; `src/app/baskets/new/`; `src/app/join/[code]/`;
`src/app/catalog/`; `src/app/operator/commodities/`; `src/app/operator/zones/`;
`src/lib/postcode.ts`; the `Payment`-based paths in `src/app/orders/actions.ts`;
and the invite-code and organiser logic in `src/app/baskets/actions.ts`.

`src/lib/money.ts`'s `savings()` is portion-based and is replaced by a per-kg
comparison or removed if no shop-price field survives on SKU.

## 11. Testing

Vitest, following the existing integration-test pattern against a real database.
Written test-first:

- Window generation from `anchorDate` and `cadenceDays`; `cutoffAt` landing at
  08:00 UTC on `deliveryDate − cutoffDays`; a window whose cutoff is already
  past being created `locked`.
- Demand aggregation: `committed`, `payment_pending` and `paid` included;
  `cancelled`, `refunded` and `payment_failed` excluded; grams summed across
  tiers.
- Cutoff decision: threshold met and supply feasible → snapshot `confirmed`,
  orders charged, PO raised; not met → snapshot `failed`, orders cancelled,
  **no charge attempted**; baskets in the same window decided independently.
- Feasibility (§5.3): stock covering demand confirms with no PO; a short lead
  time confirms with a PO for the shortfall; a long lead time with insufficient
  stock **fails the cycle without attempting any charge**.
- PurchaseOrder sizing: quantity reduced by `stockAt3pl`, suppressed entirely
  when stock covers demand, and `stockAt3pl` unchanged by the raise itself.
- Replenishment PO: raised by hand with a null `windowId`, and on
  `received_at_3pl` increments `stockAt3pl` so a later cycle confirms from stock
  with no purchase.
- Cron idempotency: a second run in the same day charges nobody twice and raises
  no duplicate PurchaseOrder.
- Charge outcomes: success → `paid`; failure → `payment_failed`; third failure →
  `cancelled`.
- Cancellation: allowed before the cutoff, refused after, refused once a charge
  has been attempted; the payment method is detached only when no other
  chargeable order holds it.
- Refund: a `paid` order → `refunded`, and it leaves demand aggregation.

## 12. Seeds

`prisma/seed.ts` is rewritten: the eight cities with staggered fortnightly
anchors, an operator and two members (existing accounts and password retained),
three `dry` products (white yam, egusi, crayfish) with one SKU each, and four
baskets — yam in Sheffield, yam in Birmingham, egusi in Manchester, crayfish in
London — so both the city filter and the same-food-different-city isolation of
v3.0 §5.3 are visible without further setup. Each basket gets the four tiers of
the v3.0 §3.2 ladder (2 kg £9.50 / 5 kg £22 / 10 kg £40 / 20 kg £72).

SKUs seed with `leadTimeDays` of 2 — UK-held goods, buyable inside the cutoff
window — matching the launch catalogue described in §5.3.

`scripts/seed-scenario.ts` is rewritten to add joined orders at varying demand
levels, plus one already-confirmed and one already-failed past window, and one
SKU carrying held stock at Hubo so the fulfil-from-inventory path is exercisable
by hand. Every demand-bar state is reachable.

## 13. Configuration

`vercel.json` replaces the 02:00 expiry cron with the 08:00 UTC cutoff cron of
§7.3. No new environment variables; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`CRON_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM` carry over unchanged.

There is no `PURCHASE_PAID_FLOOR` setting — §5.2 removes the need for one.

## 14. Emails

In scope: join confirmation (with the cutoff date, what happens at it, and a
direct cancel link), cycle confirmed, cycle cancelled for want of demand, charge
success, charge failure (with retry timeline and card-update link), basket
paused, and refund issued. Out of scope for this milestone: the pre-cutoff
reminder, delivery reminders, and dispatch tracking.
