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
