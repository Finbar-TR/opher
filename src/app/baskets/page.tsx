import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProgressBar, BasketStatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MyBasketsPage() {
  const user = await requireUser();

  const baskets = await prisma.basket.findMany({
    where: {
      OR: [{ organiserId: user.id }, { claims: { some: { userId: user.id } } }],
    },
    include: { commodity: true, claims: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
            My baskets
          </h1>
          <p className="mt-1 text-muted">Baskets you organise or have joined.</p>
        </div>
        <Link href="/catalog" className="btn-primary">
          Start a basket
        </Link>
      </div>

      {baskets.length === 0 ? (
        <div className="card text-center text-soft">
          You haven&apos;t joined any baskets yet.{" "}
          <Link href="/catalog" className="font-bold text-tomato hover:underline">
            Browse the catalog
          </Link>{" "}
          to begin.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {baskets.map((b) => {
            const filled = b.claims.reduce((s, c) => s + c.portions, 0);
            const fulfilling = b.status === "ordered" || b.status === "fulfilled";
            return (
              <Link
                key={b.id}
                href={fulfilling && b.orderId ? `/orders/${b.orderId}` : `/baskets/${b.id}`}
                className="card transition hover:border-line-strong hover:shadow-[0_8px_20px_rgba(122,60,20,0.10)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-[24px] leading-tight text-ink sm:text-[26px]">
                    {b.title}
                  </h2>
                  <BasketStatusBadge status={b.status} />
                </div>
                <p className="mt-1 text-[13px] font-semibold text-soft">
                  {b.commodity.name} · {b.commodity.bulkUnitLabel}
                </p>
                <div className="mt-4">
                  <ProgressBar filled={filled} total={b.targetPortions} />
                  <p className="mt-1 text-xs font-semibold text-soft">
                    {filled}/{b.targetPortions} portions
                  </p>
                </div>
                <p className="mt-4 text-sm font-bold text-tomato">
                  {fulfilling ? "Track delivery →" : "Open basket →"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
