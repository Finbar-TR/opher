import {
  BASKET_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  FULFILMENT_STEPS,
  type BasketStatus,
  type OrderStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { formatGBP, savings } from "@/lib/money";

// "Save £X (Y%) vs shop" — a tomato pill. Renders nothing without a real saving.
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
    <span className={`badge bg-tomato text-[#fffaf3] ${className}`}>
      Save {formatGBP(s.perPortion)} ({s.percent}%)
    </span>
  );
}

// Reassurance that money only moves when a basket completes.
export function NoFillNoFee() {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-saffron px-4 py-3 text-sm text-saffron-ink">
      <span aria-hidden>✓</span>
      <span>
        <strong>No fill, no fee.</strong> You&apos;re only charged when the basket
        completes. If it doesn&apos;t fill, you pay nothing.
      </span>
    </div>
  );
}

// A row of portion cells: filled tomato, empty warm.
export function FillMeter({
  filled,
  total,
  showLabel = true,
}: {
  filled: number;
  total: number;
  showLabel?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-[26px] w-3.5 rounded-[3px]"
          style={{ background: i < filled ? "#d6432c" : "#eeddcb" }}
          aria-hidden
        />
      ))}
      {showLabel && (
        <span className="ml-2 text-sm font-bold text-ink">
          {filled}/{total} portions
        </span>
      )}
    </div>
  );
}

// Rounded progress bar. `dark` variant sits on roast panels.
export function ProgressBar({
  filled,
  total,
  dark = false,
  className = "",
}: {
  filled: number;
  total: number;
  dark?: boolean;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;
  return (
    <div
      className={`h-3 w-full overflow-hidden rounded-full ${
        dark ? "bg-[#5a1f0c]" : "bg-line-soft"
      } ${className}`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: dark ? "#f0844c" : "#d6432c" }}
      />
    </div>
  );
}

// Striped photo placeholder (or the real image when a URL exists).
export function PhotoSlot({
  caption,
  imageUrl,
  dark = false,
  className = "",
}: {
  caption?: string;
  imageUrl?: string | null;
  dark?: boolean;
  className?: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt={caption ?? ""}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div
      className={`flex items-end p-3 ${dark ? "photo-slot-dark" : "photo-slot"} ${className}`}
    >
      {caption && (
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-[#a08064]" : "text-soft"
          }`}
        >
          {caption}
        </span>
      )}
    </div>
  );
}

const PILL = "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold";

const BASKET_BADGE: Record<BasketStatus, string> = {
  open: "bg-saffron text-saffron-ink",
  committed: "bg-saffron text-saffron-ink",
  ordered: "bg-roast text-[#fffaf3]",
  fulfilled: "bg-roast text-[#fffaf3]",
  cancelled: "bg-line-soft text-soft",
};

export function BasketStatusBadge({ status }: { status: string }) {
  const s = status as BasketStatus;
  return (
    <span className={`${PILL} ${BASKET_BADGE[s] ?? "bg-line-soft text-soft"}`}>
      {BASKET_STATUS_LABELS[s] ?? status}
    </span>
  );
}

const ORDER_BADGE: Record<OrderStatus, string> = {
  pending_payment: "bg-tomato text-[#fffaf3]",
  paid: "bg-roast text-[#fffaf3]",
  bought: "bg-roast text-[#fffaf3]",
  out_for_delivery: "bg-roast text-[#fffaf3]",
  delivered: "bg-roast text-[#fffaf3]",
  cancelled: "bg-line-soft text-soft",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const s = status as OrderStatus;
  return (
    <span className={`${PILL} ${ORDER_BADGE[s] ?? "bg-line-soft text-soft"}`}>
      {ORDER_STATUS_LABELS[s] ?? status}
    </span>
  );
}

type EventLike = { status: string; note: string; createdAt: Date };

// Vertical delivery progress. `onDark` styles it for a roast panel.
export function DeliveryTimeline({
  status,
  events,
  onDark = false,
}: {
  status: string;
  events: EventLike[];
  onDark?: boolean;
}) {
  const currentIndex = FULFILMENT_STEPS.indexOf(status as OrderStatus);
  const cancelled = status === "cancelled";
  const latestEventFor = (s: string) =>
    events.filter((e) => e.status === s).at(-1);

  return (
    <ol className="space-y-2">
      {FULFILMENT_STEPS.map((step, i) => {
        const isCurrent = !cancelled && i === currentIndex;
        const past = !cancelled && i < currentIndex;
        const reached = past || isCurrent;
        const evt = latestEventFor(step);

        const node = onDark
          ? isCurrent
            ? "bg-[#f0844c] text-[#2a1509]"
            : reached
              ? "bg-[#fdecc8] text-[#7c2d12]"
              : "border-[1.5px] border-[#9a5330] text-[#c98f65]"
          : isCurrent || reached
            ? "bg-tomato text-[#fffaf3]"
            : "border border-line-strong bg-surface text-soft";

        const labelColor = onDark
          ? isCurrent
            ? "text-[#f0844c]"
            : reached
              ? "text-[#fffaf3]"
              : "text-[#c98f65]"
          : isCurrent
            ? "text-tomato"
            : reached
              ? "text-ink"
              : "text-soft";

        const connectorReached = !cancelled && i < currentIndex;
        const connector = onDark
          ? connectorReached
            ? "bg-[#fdecc8]"
            : "bg-[#5a1f0c]"
          : connectorReached
            ? "bg-tomato"
            : "bg-line-strong";

        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${node}`}
              >
                {reached ? "✓" : i + 1}
              </span>
              {i < FULFILMENT_STEPS.length - 1 && (
                <span className={`mt-1 w-0.5 flex-1 ${connector}`} />
              )}
            </div>
            <div className="pb-3">
              <p className={`text-sm font-bold ${labelColor}`}>
                {ORDER_STATUS_LABELS[step]}
                {isCurrent && (
                  <span className="font-semibold"> — happening now</span>
                )}
              </p>
              {evt && (
                <p className={`text-xs ${onDark ? "text-[#e0a86a]" : "text-soft"}`}>
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
