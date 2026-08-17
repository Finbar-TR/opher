import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const commodities = await prisma.commodity.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-ink">Available food</h1>
        <p className="mt-1 text-muted">
          Pick a commodity to start a basket. Prices are per portion of a bulk unit.
        </p>
      </div>

      {commodities.length === 0 ? (
        <p className="text-muted">No commodities yet. Check back soon.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {commodities.map((c) => (
            <Link
              key={c.id}
              href={`/catalog/${c.id}`}
              className="card transition-shadow hover:shadow-md"
            >
              <CommodityThumb name={c.name} imageUrl={c.imageUrl} />
              <h2 className="mt-4 text-lg font-semibold text-ink">{c.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-muted">{c.bulkUnitLabel}</span>
                <span className="font-semibold text-brand-700">
                  {formatGBP(c.pricePerPortion)}
                  <span className="text-xs font-normal text-muted"> / portion</span>
                </span>
              </div>
            </Link>
          ))}
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
