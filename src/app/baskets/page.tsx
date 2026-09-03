import Link from "next/link";
import { listOpenBaskets } from "@/lib/basket-views";
import { BasketCard } from "@/components/basket-card";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// No login required to browse.
export default async function BasketsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city } = await searchParams;
  const [baskets, cities] = await Promise.all([
    listOpenBaskets(city),
    prisma.city.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-[38px] leading-tight text-ink">Baskets near you</h1>
        <p className="mt-1 text-muted">
          Join before a basket closes. Your card is saved now and charged when it
          closes — cancel free until then.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/baskets"
          className={`badge ${!city ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
        >
          All cities
        </Link>
        {cities.map((c) => (
          <Link
            key={c.id}
            href={`/baskets?city=${c.slug}`}
            className={`badge ${city === c.slug ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {baskets.length === 0 ? (
        <div className="card text-center">
          <p className="font-display text-2xl text-ink">
            No baskets in your city yet
          </p>
          <p className="mt-2 text-muted">
            We&apos;re opening new cities as demand grows — check back soon.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {baskets.map((b) => (
            <BasketCard key={b.id} basket={b} />
          ))}
        </div>
      )}
    </div>
  );
}
