# Platform-Scheduled Baskets — Design

Date: 2026-09-02
Status: Approved for planning
Supersedes: the user-organised basket model currently in `main`

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
once rather than treating v3.0 as an increment.

**Model statement.** The platform pre-schedules recurring baskets (city × food ×
delivery date). Users browse, choose a quantity tier, and join. Joining saves a
card and creates a `committed` order without charging it. The platform buys from
the importer only when demand thresholds are met. Cards are charged 24 hours
before delivery, and joins are cancellable free until then.

## 2. Scope

**In:** Product + SKU; Basket + BasketTier; per-basket DeliveryWindow;
DemandSnapshot and the purchase trigger; PurchaseOrder; Order rebuilt on Stripe
SetupIntent with deferred charging and cancellation; two crons; the admin basket
and demand surfaces; the user browse/detail/join/orders screens; v3.0 copy;
removal of the v1.0 group-buying machinery.

**Out (later milestones):** Hubo CSV manifest export and the Phase 2 3PL API;
reorder alerts; the §7.3 analytics dashboard; referral tracking (schema field
only, unused); `fresh` category products; all email beyond join confirmation,
charge success, and charge failure.

## 3. Conflicts between the documents, and how they are resolved

| # | Conflict | Resolution |
| --- | --- | --- |
| A | v2.0 `SKU` carries `label`/`weight_kg`/`price_gbp` and is the sellable variant. v3.0 `BasketTier` carries the same three fields and takes over the sell side. | SKU is **supply-side only**: wholesale cost, purchase threshold, stock at 3PL, reorder point. BasketTier is what a customer buys. SKU has no customer-facing price. |
| B | v2.0 `purchase_threshold_units` is "units of demand"; v3.0 §5.2 says KG. | Weight-based, stored as `purchaseThresholdGrams`. |
| C | v2.0 delivery windows are platform-wide fixed biweekly dates; v3.0 baskets each carry their own recurrence and `next_delivery_date`. | `DeliveryWindow` gains `basketId`. Windows are generated per basket cycle from the basket's recurrence. `Order.deliveryWindowId` identifies the cycle; `DemandSnapshot` keys on (basket, window) per v3.0 §5.1. |
| D | v2.0 §4 specifies a cart and checkout; v3.0 §10 removes the cart — join is the order. | No cart. Never built. |
| E | v2.0 collects payment immediately; v2.1 and v3.0 defer it. | Deferred. v2.1's immediate-charge path for deliveries ≤ 1 day away is retained as a guard (§7.4). |
| F | v2.0 §5 strips all group language ("no visible group mechanic", "Join a basket" → "Order at wholesale price"). v3.0 §8.3 restores it ("Join a basket", "Community delivery", a collective demand bar). | v3.0 wins. The group mechanic is visible, reframed from *coordination* (waiting on strangers) to *social proof* (a progress bar). **v2.0 §5's copy table is not applied at any point.** |
| G | v2.0 defines a stock-based fulfilment fallback (dispatch immediately if `stock_at_3pl` covers the order). | Does not apply: basket orders have fixed delivery dates. `stockAt3pl` is used only to reduce or skip a PurchaseOrder when existing stock already covers demand. |
| H | Docs assume a separate `AdminUser` entity with separate auth. | The existing `User.role = "operator"` fills this role. No second auth system. |

## 4. Deviations from the documents

Both are deliberate, and preserve documented behaviour.

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
persists only `purchaseTriggered` and `purchaseTriggeredAt` — the state that
genuinely cannot be recomputed.

## 5. Issue found in the documented purchase trigger

v2.1 §4 and v3.0 §5.2 gate the PurchaseOrder on:

```
total_units_ordered >= purchase_threshold_units
AND PAID_only_total >= purchase_threshold_units * 0.5
AND purchase_triggered == false
```

**As specified this can never fire in useful time.** Demand aggregates per
(basket, window). Orders for a window are charged at 08:00 UTC on
`deliveryDate − 1`, so no order in that window reaches `paid` until 24 hours
before delivery — after the 48-hour join cutoff has already passed, and far too
late to order from an importer and have goods reach the 3PL. The paid floor is
satisfiable only after the purchase decision is moot.

**Resolution.** The predicate is implemented exactly as documented, with the
floor as a configurable setting — which is what v2.1 §4 itself calls for ("The
50% floor is a configurable admin setting — adjust as cancellation rate data
becomes available"). It ships defaulted to **0**, making the trigger effectively
committed-demand-based, as v2.0 originally specified. Raising it becomes
meaningful only if paid history from prior cycles is later folded into the
confidence measure, which is out of scope here.

`PURCHASE_PAID_FLOOR = 0` lives in `src/lib/constants.ts` with a comment
pointing at this section.

**Operational assumption to validate separately:** firing the trigger at the
48-hour cutoff leaves the importer under two days to ship to Hubo before the
delivery date. This design implements the documented timings faithfully; whether
the supply chain can meet them is a business question, not a code one.

## 6. Data model

Conventions follow the existing schema: `cuid()` primary keys, statuses as plain
lowercase strings defined in `src/lib/constants.ts` rather than DB enums (for
provider portability, per the schema header), money as integer pence.

**Weights are integer grams.** Threshold sums drive purchase decisions and must
not accumulate float error — the same reasoning that makes money pence. `2 kg` is
stored as `2000` and displayed as kg.

### New models

**Product** — `id`, `name`, `description`, `imageUrl?`, `category`
(`dry` | `fresh`), `active`, `createdAt`.

**Sku** — `id`, `productId`, `label`, `weightGrams`, `wholesaleCostPence`,
`purchaseThresholdGrams`, `stockAt3pl`, `reorderPoint`, `active`, `createdAt`.
Supply-side only; no customer-facing price (conflict A).

**Basket** — `id`, `skuId`, `city`, `label`, `recurrence`
(`weekly` | `fortnightly` | `monthly`), `recurrenceDay` (0–6, 0 = Monday),
`orderCutoffHours` (default 48), `status` (`open` | `locked` | `paused` |
`archived`), `minJoiners`, `createdById`, `createdAt`.

`next_delivery_date` from v3.0 §3.1 is **not** stored. It is derived from the
basket's open `DeliveryWindow`, so the two cannot disagree.

`minJoiners` is stored and displayed to the admin but gates nothing: v3.0 §3.1
is explicit that it is a soft marketing floor and that the threshold alone
governs purchasing. No code branches on it.

**BasketTier** — `id`, `basketId`, `label`, `weightGrams`, `pricePence`,
`active`, `displayOrder`. Price per kg is computed for display, never stored.
2–4 active tiers per basket, enforced in app code.

**DeliveryWindow** — `id`, `basketId`, `deliveryDate`, `cutoffAt`, `status`
(`open` | `locked` | `dispatched` | `cancelled`), `notes`, `createdAt`.
`cutoffAt = deliveryDate − basket.orderCutoffHours`.

**DemandSnapshot** — `id`, `basketId`, `windowId`, `purchaseTriggered`,
`purchaseTriggeredAt?`. Unique on (`basketId`, `windowId`). No stored totals
(§4.2).

**PurchaseOrder** — `id`, `skuId`, `windowId`, `quantityGrams`,
`totalCostPence`, `status` (`pending` | `sent` | `confirmed` |
`received_at_3pl`), `importerRef?`, `createdAt`.

### Rewritten

**Order** — `id`, `userId`, `basketId`, `basketTierId`, `deliveryWindowId`,
`status` (`committed` | `payment_pending` | `paid` | `payment_failed` |
`dispatching` | `delivered` | `cancelled`), `stripeCustomerId`,
`stripeSetupIntentId`, `stripePaymentMethodId`, `stripePaymentIntentId?`,
`debitDate`, `cancellationDeadline`, `paymentAttemptedAt?`, `paymentRetryCount`
(default 0), `totalPence`, `deliveryAddress` (snapshot at join),
`utmSource?`, `utmMedium?`, `utmCampaign?`, `referrerOrderId?`, `createdAt`.

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

### Cities

Eight, as a constant list in `src/lib/constants.ts`, used for the admin dropdown
and the browse filter: London, Birmingham, Manchester, Leeds, Sheffield,
Leicester, Bristol, Nottingham. `Basket.city` stores the name as a string; the
constant is the validation source.

## 7. Lifecycle

### 7.1 Recurrence

Next delivery date is computed from the current window's `deliveryDate`:

- `weekly` — +7 days
- `fortnightly` — +14 days
- `monthly` — same day-of-month in the following month, clamped to the month's
  length (a 31st becomes the 30th in September, the 28th or 29th in February).
  `recurrenceDay` is ignored for monthly.

The first window's date is chosen by the admin at creation and must fall on
`recurrenceDay` for weekly and fortnightly baskets (validated in the form).

### 7.2 Basket and window status

- Window `open` → `locked` when `cutoffAt` passes. No new joins.
- Window `locked` → `dispatched` on the delivery date; the basket's next window
  is created `open`.
- Basket `open` → `paused` by admin: new joins stop, existing orders are
  retained, joiners are emailed. `paused` → `open` restores.
- Basket → `archived` by admin: no further windows are created. Existing windows
  run to completion.

A window belonging to a paused or archived basket accepts no joins regardless of
its own status.

### 7.3 Crons

`/api/cron/expire` targets baskets and orders that no longer exist under this
model and is replaced by two routes, both reusing its `CRON_SECRET` guard and
GET/POST shape. This takes the cron count from one to two.

**`/api/cron/baskets` — 00:00 UTC daily**
1. Lock windows whose `cutoffAt` has passed.
2. Advance windows past their delivery date to `dispatched`; create the next
   window for non-archived baskets.
3. For each open snapshot, evaluate the purchase trigger (§5). On fire: create
   `PurchaseOrder` (quantity reduced by `sku.stockAt3pl`, skipped entirely if
   stock covers demand — conflict G), set `purchaseTriggered`, notify admin.

`stockAt3pl` is **not** decremented when a PurchaseOrder is raised — the
reduction above only sizes the order. Stock increments when the admin marks a
PurchaseOrder `received_at_3pl` and decrements when a window's orders move to
`dispatching`, so it always reflects goods physically at the warehouse.

**`/api/cron/charge` — 08:00 UTC daily**
1. For each `committed` order with `debitDate = today`: set `payment_pending`,
   charge off-session via PaymentIntent, then `paid` or `payment_failed`.
2. Retry `payment_failed` orders once daily; on the third failure set
   `cancelled` and notify.

08:00 is not arbitrary: `cancellationDeadline` is defined as 08:00 UTC on
`debitDate`, so the cron time *is* the deadline. Changing one changes both.

### 7.4 Join

Route `/baskets/:id/join`, single page, no reloads: delivery address → tier
confirm → Stripe Elements → confirm.

1. Server action ensures a Stripe Customer for the user and creates a
   SetupIntent with `usage: "off_session"`; returns the client secret.
2. Stripe.js confirms; the payment method id comes back.
3. The Order is written (§4.1) with `debitDate = deliveryDate − 1 day` and
   `cancellationDeadline` = 08:00 UTC on that date, status `committed`.
4. UTM parameters present on the URL are stored on the Order.

**Immediate-charge guard.** If the delivery date is ≤ 1 day away at join time,
v2.1 §2 requires charging immediately via PaymentIntent with `debitDate = today`
and status `paid`. With a 48-hour cutoff this path is unreachable, but it is
implemented so that lowering `orderCutoffHours` cannot silently create orders
that are never charged.

**Dev fallback.** The existing no-Stripe-key path is preserved: with no
`STRIPE_SECRET_KEY`, joining stores a placeholder payment method and the charge
cron marks orders paid directly, keeping the flow clickable locally.

### 7.5 Cancellation

Permitted while `now < cancellationDeadline` and status is `committed`. Sets
`cancelled`, clears `stripePaymentMethodId` on the order (v2.1 §7, GDPR), and
emails confirmation.

Refused otherwise — and never permitted after a charge attempt, even a failed
one; the retry flow handles those. If the window's snapshot already has
`purchaseTriggered`, the cancellation is flagged for admin review and the
PurchaseOrder is **not** auto-reversed.

The payment method is detached from the Stripe Customer **only if no other order
still depends on it**. A user with two committed joins shares one saved card, so
unconditionally detaching on the first cancellation would silently break the
charge for the second. Detach only when no remaining order for that user holds
the same `stripePaymentMethodId` in a chargeable status.

## 8. Admin surface

Extends the existing `/operator` shell; `requireOperator()` guards throughout.

| Screen | Contents |
| --- | --- |
| Products / SKUs | Replaces `/operator/commodities`. Product CRUD; SKU CRUD with threshold, wholesale cost, stock, reorder point. |
| Basket list | Filter by city, product, status. Columns: city, food, next delivery, joiners, kg demanded, % of threshold, status. |
| Create basket | City dropdown (the 8), SKU dropdown, recurrence, recurrence day, first delivery date, cutoff hours. Label auto-generated as `"{Product} — {City} — {Recurrence description}"` and editable. 2–4 tiers added inline. |
| Edit basket | Label, recurrence, cutoff hours, tiers (add/disable). City and SKU are locked once any order exists against the basket. |
| Pause / archive | Pause emails existing joiners. Archive stops future windows. |
| Basket detail | Orders for a given basket × window: user, tier, status, debit date, payment state. |
| Demand dashboard | Every open window: kg demanded vs threshold, % filled, days to cutoff. Sorted by urgency. |
| Purchase orders | List, confirm with importer, log `importerRef`, advance status. Setting `received_at_3pl` increments `sku.stockAt3pl`. |

## 9. User surface

| Route | Contents |
| --- | --- |
| `/` | Hero: "Fresh African staples delivered to your door — join your local basket." CTA to `/baskets`. No login to browse. |
| `/baskets` | City filter across the 8 (from the user's saved city if set, else manual). Cards: photo, city, delivery date, tier price range, compact demand bar. Sorted by delivery date ascending. |
| `/baskets/:id` | Product info, tier selector with price per kg, delivery date, full demand bar, join CTA, "How it works" accordion. |
| `/baskets/:id/join` | The multi-step flow of §7.4. |
| `/orders` | Joined baskets: product, city, tier, delivery date, status badge, cancel button when before deadline. |
| `/orders/:id` | Full detail, payment status, cancel with deadline warning, delivery timeline. |

### 9.1 Demand bar

Progress is `demanded grams / sku.purchaseThresholdGrams`.

- Compact (browse card): coloured bar, "X% to delivery confirmed".
- Full (detail): bar plus "X kg joined · Y kg needed · Z days left to join".
- Below 20% filled: suppress raw numbers, show "Be one of the first to join!"
- Triggered: green — "Delivery confirmed — we've ordered your food!"
- Basket paused: amber — "Temporarily paused — existing orders retained."
- Window locked: grey — "Joining closed — next delivery on [date]", linking to
  the next window when one exists.

### 9.2 Copy

v3.0 §8.3 governs. v2.0 §5 is not applied (conflict F). "Create a basket" → "Join
a basket"; "Your basket is empty" → "No baskets in your city yet — check back
soon"; "Add to basket" → "Join this basket"; "Checkout" → "Confirm your spot";
"Order placed" → "You're in! We'll charge your card on [debit date]"; "Group
buying" → "Community delivery"; "Minimum members needed" → "Building demand —
[X]% there".

The v2.1 §6 disclosure block is mandatory at the confirm step and its wording is
a compliance requirement, not a style choice:

```
Delivery window: Saturday 18 October
Your card will be charged on: Friday 17 October
Cancel before 8am on 17 October for free · No charge until then
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

- Debit date and cancellation deadline computation, including the ≤ 1 day
  immediate-charge branch.
- Recurrence advancement for all three cadences, including monthly clamping at
  month ends.
- Window cutoff locking.
- Demand aggregation: `committed`, `payment_pending` and `paid` included;
  `cancelled` and `payment_failed` excluded; grams summed across tiers.
- Purchase trigger: fires once and only once; respects the configurable paid
  floor; reduces quantity by available 3PL stock and skips when stock covers.
- Cancellation: allowed before the deadline, refused after, refused once a
  charge has been attempted, flags admin when the PO is already raised.
- Charge cron: success → `paid`; failure → `payment_failed`; third failure →
  `cancelled`.

## 12. Seeds

`prisma/seed.ts` is rewritten: an operator and two members (existing accounts and
password retained), three `dry` products (white yam, egusi, crayfish) with one
SKU each, and four baskets — yam in Sheffield, yam in Birmingham, egusi in
Manchester, crayfish in London — so that both the city filter and the
same-food-different-city isolation of v3.0 §5.3 are visible without further
setup. Each basket gets the four tiers of the v3.0 §3.2 ladder (2 kg £9.50 /
5 kg £22 / 10 kg £40 / 20 kg £72) and one open delivery window.
`scripts/seed-scenario.ts` is rewritten to add joined orders at varying demand
levels so every demand-bar state is reachable by hand.

## 13. Configuration

New: `PURCHASE_PAID_FLOOR` (constant, default 0 — see §5). `vercel.json` replaces
the single expiry cron with the two of §7.3. No new environment variables;
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` and
`EMAIL_FROM` carry over unchanged.

## 14. Emails

In scope: join confirmation (with debit date, cancellation deadline and a direct
cancel link), charge success, charge failure (with retry timeline and card-update
link), and basket paused. Out of scope for this milestone: the 48-hour
pre-charge reminder, delivery reminders, and demand-confirmed announcements.
