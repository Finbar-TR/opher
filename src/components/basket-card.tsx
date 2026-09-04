import Link from "next/link";
import { PhotoSlot } from "./ui";
import { DemandNote } from "./demand-note";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";
import type { BasketCard as Card } from "@/lib/basket-views";

export function BasketCard({ basket }: { basket: Card }) {
  return (
    <Link href={`/baskets/${basket.id}`} className="card block transition hover:border-line-strong">
      <PhotoSlot imageUrl={basket.imageUrl} caption={basket.productName} />
      <div className="mt-4">
        <span className="badge bg-brand-50 text-brand-800">{basket.city}</span>
        <h3 className="mt-2 font-display text-2xl text-ink">{basket.productName}</h3>
        <p className="mt-1 text-sm text-muted">
          Delivered {formatWeekday(basket.deliveryDate)}
        </p>
        <p className="mt-3 text-[15px] font-semibold text-ink">
          {formatGBP(basket.minPricePence)} – {formatGBP(basket.maxPricePence)}
        </p>
        <div className="mt-3">
          <DemandNote joiners={basket.joiners} grams={basket.grams} />
        </div>
      </div>
    </Link>
  );
}
