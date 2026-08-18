import {
  BASKET_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  FULFILMENT_STEPS,
  type BasketStatus,
  type OrderStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { formatGBP, savings } from "@/lib/money";

// "Save £X (Y%) vs shop" — renders nothing when there's no shop price / no saving.
export function SavingsBadge({
  pricePerPortion,
  shopPricePerPortion,
  className = "",
}: {
  pricePerPortion: number;
  shopPricePerPortion: number | null;
  className?: string;
}) {
  const s = savings(pricePerPortion, shopPricePerPortion);
  if (!s) return null;
  return (
    <span className={`badge bg-accent-400/25 text-accent-600 ${className}`}>
      Save {formatGBP(s.perPortion)} ({s.percent}%) vs shop
    </span>
  );
}

// Reassurance that money only moves when a basket completes.
export function NoFillNoFee() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
      <span aria-hidden>✓</span>
      <span>
        <strong>No fill, no fee.</strong> You&apos;re only charged when the basket
        completes. If it doesn&apos;t fill, you pay nothing.
      </span>
    </div>
  );
}

// A row of portion cells: filled cells are brand-green, empty are grey.
export function FillMeter({
  filled,
  total,
}: {
  filled: number;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-7 w-5 rounded-sm ${
            i < filled ? "bg-brand-500" : "bg-line"
          }`}
          aria-hidden
        />
      ))}
      <span className="ml-2 text-sm font-semibold text-ink">
        {filled}/{total} portions
      </span>
    </div>
  );
}

const BASKET_BADGE: Record<BasketStatus, string> = {
  open: "bg-brand-100 text-brand-800",
  committed: "bg-accent-400/30 text-accent-600",
  ordered: "bg-blue-100 text-blue-700",
  fulfilled: "bg-brand-100 text-brand-800",
  cancelled: "bg-line text-muted",
};

export function BasketStatusBadge({ status }: { status: string }) {
  const s = status as BasketStatus;
  return (
    <span className={`badge ${BASKET_BADGE[s] ?? "bg-line text-muted"}`}>
      {BASKET_STATUS_LABELS[s] ?? status}
    </span>
  );
}

const ORDER_BADGE: Record<OrderStatus, string> = {
  pending_payment: "bg-accent-400/30 text-accent-600",
  paid: "bg-blue-100 text-blue-700",
  bought: "bg-blue-100 text-blue-700",
  out_for_delivery: "bg-brand-100 text-brand-800",
  delivered: "bg-brand-500 text-white",
  cancelled: "bg-line text-muted",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const s = status as OrderStatus;
  return (
    <span className={`badge ${ORDER_BADGE[s] ?? "bg-line text-muted"}`}>
      {ORDER_STATUS_LABELS[s] ?? status}
    </span>
  );
}

type EventLike = { status: string; note: string; createdAt: Date };

// Vertical delivery progress: each fulfilment step is reached, current, or
// upcoming, based on the order's status. Event timestamps/notes are shown when
// available.
export function DeliveryTimeline({
  status,
  events,
}: {
  status: string;
  events: EventLike[];
}) {
  const currentIndex = FULFILMENT_STEPS.indexOf(status as OrderStatus);
  const cancelled = status === "cancelled";
  const latestEventFor = (s: string) =>
    events.filter((e) => e.status === s).at(-1);

  return (
    <ol className="space-y-4">
      {FULFILMENT_STEPS.map((step, i) => {
        const reached = !cancelled && i <= currentIndex;
        const isCurrent = !cancelled && i === currentIndex;
        const evt = latestEventFor(step);
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  reached
                    ? "bg-brand-600 text-white"
                    : "border border-line bg-surface text-muted"
                }`}
              >
                {reached ? "✓" : i + 1}
              </span>
              {i < FULFILMENT_STEPS.length - 1 && (
                <span
                  className={`mt-1 w-0.5 flex-1 ${
                    i < currentIndex ? "bg-brand-500" : "bg-line"
                  }`}
                />
              )}
            </div>
            <div className="pb-2">
              <p
                className={`text-sm font-semibold ${
                  isCurrent ? "text-brand-700" : reached ? "text-ink" : "text-muted"
                }`}
              >
                {ORDER_STATUS_LABELS[step]}
              </p>
              {evt && (
                <p className="text-xs text-muted">
                  {formatDateTime(evt.createdAt)}
                  {evt.note ? ` · ${evt.note}` : ""}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
