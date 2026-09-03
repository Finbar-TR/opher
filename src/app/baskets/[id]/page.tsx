import Link from "next/link";
import { notFound } from "next/navigation";
import { getBasketDetail } from "@/lib/basket-views";
import { DemandNote } from "@/components/demand-note";
import { PhotoSlot } from "@/components/ui";
import { formatGBP, formatPricePerKg } from "@/lib/money";
import { formatWeekday, daysBetween } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function BasketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const basket = await getBasketDetail(id);
  if (!basket) notFound();

  const now = new Date();
  const daysLeft = daysBetween(now, basket.cutoffAt);
  const open = basket.status === "open";
  const paused = basket.status === "paused";
  const archived = basket.status === "archived";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link href="/baskets" className="text-sm text-muted hover:underline">
        ← All baskets
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <PhotoSlot imageUrl={basket.imageUrl} caption={basket.productName} />
        <div>
          <span className="badge bg-brand-50 text-brand-800">{basket.city}</span>
          <h1 className="mt-3 font-display text-[38px] leading-tight text-ink">
            {basket.productName}
          </h1>
          {basket.description && (
            <p className="mt-3 text-muted">{basket.description}</p>
          )}

          <div className="mt-5 rounded-xl border border-line bg-brand-50 p-4">
            <p className="font-semibold text-ink">
              Delivered {formatWeekday(basket.deliveryDate)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Closes {formatWeekday(basket.cutoffAt)}
              {daysLeft > 0 && ` · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to join`}
            </p>
          </div>

          <div className="mt-4">
            <DemandNote joiners={basket.joiners} grams={basket.grams} />
          </div>

          {open && (
            <Link href={`/baskets/${basket.id}/join`} className="btn-primary mt-6 inline-block">
              Join this basket
            </Link>
          )}
          {paused && (
            <p className="mt-6 rounded-xl border border-line bg-saffron p-4 text-sm font-medium text-saffron-ink">
              Temporarily paused — existing orders are unaffected.
            </p>
          )}
          {archived && (
            <p className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm text-muted">
              This basket is no longer running.{" "}
              <Link href="/baskets" className="font-semibold text-ink hover:underline">
                See what&apos;s open now
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      <section>
        <h2 className="font-display text-2xl text-ink">Sizes</h2>
        <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
          {basket.tiers.map((t) => (
            <div key={t.id} className="flex items-baseline justify-between px-4 py-3">
              <span className="font-medium text-ink">{t.label}</span>
              <span className="text-right">
                <span className="font-semibold text-ink">{formatGBP(t.pricePence)}</span>
                <span className="ml-2 text-sm text-muted">
                  {formatPricePerKg(t.pricePerKgPence)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="font-display text-2xl text-ink">How it works</h2>
        <ol className="mt-3 space-y-3 text-[15px] text-muted">
          <li>
            <strong className="text-ink">1. Join.</strong> Pick a size and enter
            your card. Nothing is charged yet.
          </li>
          <li>
            <strong className="text-ink">2. The basket closes</strong>{" "}
            {basket.cutoffDays} {basket.cutoffDays === 1 ? "day" : "days"} before
            delivery. That&apos;s when your card is charged — cancel free any
            time before it.
          </li>
          <li>
            <strong className="text-ink">3. Delivery.</strong> Your order arrives
            on {formatWeekday(basket.deliveryDate)}.
          </li>
          <li>
            <strong className="text-ink">If too few neighbours join,</strong> we
            move the delivery to the next date and let you know — you&apos;re
            never charged for a delivery that didn&apos;t run.
          </li>
        </ol>
      </section>
    </div>
  );
}
