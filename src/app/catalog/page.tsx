import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { SavingsBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const commodities = await prisma.commodity.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  // Live demand per commodity — open baskets and portions claimed — to make the
  // catalogue feel active rather than empty.
  const openBaskets = await prisma.basket.findMany({
    where: { status: "open" },
    select: { commodityId: true, claims: { select: { portions: true } } },
  });
  const liveness = new Map<string, { baskets: number; portions: number }>();
  for (const b of openBaskets) {
    const e = liveness.get(b.commodityId) ?? { baskets: 0, portions: 0 };
    e.baskets += 1;
    e.portions += b.claims.reduce((s, c) => s + c.portions, 0);
    liveness.set(b.commodityId, e);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-ink">What&apos;s available</h1>
        <p className="mt-1 text-muted">
          Pick an item to start a basket. Prices are per portion of a bulk unit —
          and you only pay when a basket completes.
        </p>
      </div>

      {commodities.length === 0 ? (
        <p className="text-muted">Nothing listed yet. Check back soon.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {commodities.map((c) => {
            const live = liveness.get(c.id);
            return (
              <Link
                key={c.id}
                href={`/catalog/${c.id}`}
                className="card transition-shadow hover:shadow-md"
              >
                <CommodityThumb name={c.name} imageUrl={c.imageUrl} />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="badge bg-brand-100 text-brand-800">
                    {c.category}
                  </span>
                  <SavingsBadge
                    pricePerPortion={c.pricePerPortion}
                    shopPricePerPortion={c.shopPricePerPortion}
                  />
                </div>
                <h2 className="mt-2 text-lg font-semibold text-ink">{c.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-muted">{c.bulkUnitLabel}</span>
                  <span className="font-semibold text-brand-700">
                    {formatGBP(c.pricePerPortion)}
                    <span className="text-xs font-normal text-muted"> / portion</span>
                  </span>
                </div>
                {live && live.baskets > 0 && (
                  <p className="mt-2 text-xs font-medium text-brand-700">
                    ● {live.baskets} open basket{live.baskets === 1 ? "" : "s"} ·{" "}
                    {live.portions} portion{live.portions === 1 ? "" : "s"} claimed
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CommodityThumb({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-28 w-full rounded-lg object-cover"
      />
    );
  }
  return (
    <div className="flex h-28 w-full items-center justify-center rounded-lg bg-brand-100 text-3xl font-bold text-brand-700">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
