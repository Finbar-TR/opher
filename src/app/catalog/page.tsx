import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatGBP, savings } from "@/lib/money";
import { PhotoSlot, ProgressBar } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;

  const commodities = await prisma.commodity.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const categories = [...new Set(commodities.map((c) => c.category))];
  const shown = category
    ? commodities.filter((c) => c.category === category)
    : commodities;

  // Per-commodity liveness: open-basket count, portions claimed, and the fullest
  // open basket (the one most worth joining).
  const openBaskets = await prisma.basket.findMany({
    where: { status: "open" },
    select: {
      commodityId: true,
      targetPortions: true,
      claims: { select: { portions: true } },
    },
  });
  const live = new Map<
    string,
    { count: number; portions: number; bestFilled: number; bestTotal: number }
  >();
  for (const b of openBaskets) {
    const filled = b.claims.reduce((s, c) => s + c.portions, 0);
    const e = live.get(b.commodityId) ?? {
      count: 0,
      portions: 0,
      bestFilled: 0,
      bestTotal: 0,
    };
    e.count += 1;
    e.portions += filled;
    if (b.targetPortions - filled < e.bestTotal - e.bestFilled || e.bestTotal === 0) {
      e.bestFilled = filled;
      e.bestTotal = b.targetPortions;
    }
    live.set(b.commodityId, e);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
            What&apos;s cooking this week
          </h1>
          <p className="mt-1 text-muted">
            Pick an item to start a basket. Prices are per portion of a bulk unit —
            and you only pay when a basket completes.
          </p>
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <FilterPill href="/catalog" active={!category}>
              All
            </FilterPill>
            {categories.map((cat) => (
              <FilterPill
                key={cat}
                href={`/catalog?category=${encodeURIComponent(cat)}`}
                active={category === cat}
              >
                {cat}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="card text-center text-soft">Nothing listed yet. Check back soon.</div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => {
            const l = live.get(c.id);
            const s = savings(c.pricePerPortion, c.shopPricePerPortion);
            const remaining = l ? l.bestTotal - l.bestFilled : 0;
            return (
              <Link
                key={c.id}
                href={`/catalog/${c.id}`}
                className="group overflow-hidden rounded-[22px] border border-line bg-surface transition hover:border-line-strong hover:shadow-[0_8px_20px_rgba(122,60,20,0.10)]"
              >
                <div className="relative">
                  <PhotoSlot
                    caption={c.name}
                    imageUrl={c.imageUrl}
                    className="h-[150px] w-full"
                  />
                  {s && (
                    <span className="badge absolute left-3 top-3 bg-tomato text-[#fffaf3]">
                      Save {formatGBP(s.perPortion)} ({s.percent}%)
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <p className="eyebrow">
                    {c.category} · {c.bulkUnitLabel}
                  </p>
                  <h2 className="mt-1 font-display text-[26px] leading-tight text-ink">
                    {c.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>

                  {l && (
                    <div className="mt-4">
                      <ProgressBar
                        filled={l.bestFilled}
                        total={l.bestTotal}
                        className="h-2.5"
                      />
                      <p className="mt-1 text-xs font-semibold text-soft">
                        {l.bestFilled}/{l.bestTotal} filled
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-bold text-[22px] text-tomato">
                      {formatGBP(c.pricePerPortion)}
                      <span className="text-xs font-normal text-soft"> / portion</span>
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        remaining === 1 ? "text-tomato" : "text-saffron-ink"
                      }`}
                    >
                      {!l
                        ? "Start one →"
                        : remaining === 1
                          ? "1 portion left →"
                          : `${l.count} basket${l.count === 1 ? "" : "s"} open →`}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
        active
          ? "bg-roast text-[#fffaf3]"
          : "border border-line bg-surface text-muted hover:border-line-strong"
      }`}
    >
      {children}
    </Link>
  );
}

// Striped photo placeholder (or image) with the commodity's initial-free caption.
export function CommodityThumb({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}) {
  return <PhotoSlot caption={name} imageUrl={imageUrl} className="h-28 w-full rounded-lg" />;
}
