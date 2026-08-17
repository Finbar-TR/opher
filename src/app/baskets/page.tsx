import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FillMeter, BasketStatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MyBasketsPage() {
  const user = await requireUser();

  const baskets = await prisma.basket.findMany({
    where: {
      OR: [
        { organiserId: user.id },
        { claims: { some: { userId: user.id } } },
      ],
    },
    include: { commodity: true, claims: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">My baskets</h1>
          <p className="mt-1 text-muted">Baskets you organise or have joined.</p>
        </div>
        <Link href="/catalog" className="btn-primary">
          Start a basket
        </Link>
      </div>

      {baskets.length === 0 ? (
        <div className="card text-center text-muted">
          You haven&apos;t joined any baskets yet.{" "}
          <Link href="/catalog" className="text-brand-700 hover:underline">
            Browse the catalog
          </Link>{" "}
          to begin.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {baskets.map((b) => {
            const filled = b.claims.reduce((s, c) => s + c.portions, 0);
            return (
              <Link key={b.id} href={`/baskets/${b.id}`} className="card hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-ink">{b.title}</h2>
                  <BasketStatusBadge status={b.status} />
                </div>
                <p className="mt-1 text-sm text-muted">{b.commodity.name}</p>
                <div className="mt-4">
                  <FillMeter filled={filled} total={b.targetPortions} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
