// Shared string unions and human labels. Kept in one place because the DB stores
// these as plain strings (for schema portability) rather than enums.

export const ROLES = ["member", "operator"] as const;
export type Role = (typeof ROLES)[number];

export const BASKET_STATUSES = [
  "open",
  "committed",
  "ordered",
  "fulfilled",
  "cancelled",
] as const;
export type BasketStatus = (typeof BASKET_STATUSES)[number];

export const BASKET_STATUS_LABELS: Record<BasketStatus, string> = {
  open: "Open — accepting members",
  committed: "Committed — awaiting merge",
  ordered: "Ordered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

// Ordered fulfilment lifecycle for an Order. Index gives progress ordering.
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "bought",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  bought: "Bought",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// The forward-only fulfilment steps an operator advances through (excludes the
// payment/cancel states). Used to render the delivery timeline and next-step UI.
export const FULFILMENT_STEPS: OrderStatus[] = [
  "paid",
  "bought",
  "out_for_delivery",
  "delivered",
];

export const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Auto-expiry defaults.
export const BASKET_DEFAULT_CLOSE_DAYS = 14; // open/committed baskets close after this
export const ORDER_PAYMENT_DUE_DAYS = 3; // pending_payment orders auto-cancel + refund after this
