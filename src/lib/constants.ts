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
