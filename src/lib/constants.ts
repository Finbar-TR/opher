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

export const PRODUCT_CATEGORIES = ["dry", "fresh"] as const;

export const BASKET_STATUSES = ["open", "paused", "archived"] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];

// `rolled_over` is a window the operator moved to the next delivery date rather
// than running it — a thin cycle, a supply problem. It is terminal for this
// window: `cycle-run.ts` phase 2 only ever selects `open`/`locked`, so a
// rolled-over window is excluded from the cutoff and charges nobody.
export const WINDOW_STATUSES = [
  "open",
  "locked",
  "dispatched",
  "cancelled",
  "rolled_over",
] as const;
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

// Orders in these statuses count toward a basket's demand for a window.
// cancelled, refunded and payment_failed are excluded.
export const DEMAND_COUNTED_STATUSES: OrderStatus[] = [
  "committed",
  "payment_pending",
  "paid",
];

// The hour (UTC) at which a window's cutoff falls and the daily cron runs.
// These are the same moment by design: the cutoff IS the charge.
export const CUTOFF_HOUR_UTC = 8;

export const DEFAULT_CADENCE_DAYS = 14; // fortnightly
export const DEFAULT_CUTOFF_DAYS = 3; // joins close 3 days before delivery

// How many future windows to keep open per city, so a customer can always see
// the next delivery and the one after it.
export const OPEN_WINDOWS_AHEAD = 2;

// Established charge failures before an order is released. Only an outcome
// Stripe actually confirmed increments the count this bounds.
export const MAX_PAYMENT_RETRIES = 3;

// The termination guarantee. `MAX_PAYMENT_RETRIES` alone cannot end the loop:
// an attempt that is abandoned or left undetermined deliberately spends no
// retry, so an order whose charge can never reach Stripe would be retried for
// ever — and it cannot be cancelled by the customer either, because joins.ts
// refuses once `paymentAttemptedAt` is set. This caps TOTAL attempts however
// they resolved, so every order reaches an exit.
export const MAX_PAYMENT_ATTEMPTS = 6;

// The cron's Vercel function timeout, in seconds. It lives here rather than as
// a literal in the route because PAYMENT_RECONCILE_AFTER_MINUTES below must
// stay comfortably larger than it — see the note there.
export const CRON_MAX_DURATION_SECONDS = 300;

// A charge attempt still `pending` after this long is presumed interrupted and
// is reconciled against Stripe. Not a retry delay — a staleness threshold.
//
// MUST stay comfortably greater than CRON_MAX_DURATION_SECONDS above. The
// runtime kills a run at that timeout, so an attempt cannot still be genuinely
// in flight once this has elapsed. If this were the shorter of the two, a
// reconciler could race a charge call that is still running, decide from
// Stripe's "nothing here yet" that no charge exists, and authorise a second
// one. `constants.test.ts` asserts the relationship rather than trusting this
// comment.
export const PAYMENT_RECONCILE_AFTER_MINUTES = 10;

// How far either side of a charge attempt's OWN timestamp to search Stripe for
// the PaymentIntent it may have created.
//
// Anchored on the attempt, never on the current time. The write-ahead ordering
// guarantees the intent — if one exists at all — was created within seconds of
// the attempt row, so this window is generous for clock skew and a slow call
// while staying CONSTANT: it does not widen as the attempt ages.
//
// That property is what keeps `findIntentsForAttempt`'s paging bounded. An
// earlier design anchored the lower bound on `now`, so the range grew every day
// an attempt stayed unsettled, eventually sweeping months of a customer's
// PaymentIntents and hitting the page limit — which froze the order for a human
// precisely because it had been waiting for a human.
export const PAYMENT_LOOKUP_BEFORE_MINUTES = 5;
export const PAYMENT_LOOKUP_AFTER_HOURS = 24;

export const PAYMENT_ATTEMPT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "requires_action",
  "abandoned",
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];
