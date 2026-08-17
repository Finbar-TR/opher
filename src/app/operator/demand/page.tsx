import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FillMeter } from "@/components/ui";
import { runMergeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  await requireOperator();

  // Committed baskets not yet merged into an order, grouped by commodity.
  const baskets = await prisma.basket.findMany({
    where: { status: "committed", orderId: null },
    include: { commodity: true, claims: true, organiser: true },
    orderBy: { createdAt: "asc" },
  });

  const byCommodity = new Map<
    string,
    { commodity: (typeof baskets)[number]["commodity"]; baskets: typeof baskets }
  >();
  for (const b of baskets) {
    const entry = byCommodity.get(b.commodityId) ?? {
      commodity: b.commodity,
      baskets: [],
    };
    entry.baskets.push(b);
    byCommodity.set(b.commodityId, entry);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/operator" className="text-sm text-muted hover:underline">
          ← Operator
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-ink">Demand &amp; merges</h1>
        <p className="mt-1 text-muted">
          Committed baskets waiting to complete a whole bulk unit. Merges also run
          automatically when a basket commits.
        </p>
      </div>

      {byCommodity.size === 0 ? (
        <div className="card text-center text-muted">
          No committed baskets awaiting merge.
        </div>
      ) : (
        <div className="space-y-6">
          {[...byCommodity.values()].map(({ commodity, baskets }) => {
            const totalPortions = baskets.reduce(
              (s, b) => s + b.claims.reduce((x, c) => x + c.portions, 0),
              0
            );
            const unit = commodity.portionsPerBulkUnit;
            const completeUnits = Math.floor(totalPortions / unit);
            return (
              <div key={commodity.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">
                      {commodity.name}
                    </h2>
                    <p className="text-sm text-muted">
                      {totalPortions} portion(s) committed · {unit} per{" "}
                      {commodity.bulkUnitLabel} ·{" "}
                      <span
                        className={
                          completeUnits > 0
                            ? "font-semibold text-brand-700"
                            : "text-muted"
                        }
                      >
                        {completeUnits} whole unit(s) ready
                      </span>
                    </p>
                  </div>
                  <form action={runMergeAction}>
                    <input type="hidden" name="commodityId" value={commodity.id} />
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={completeUnits < 1}
                    >
                      Run merge
                    </button>
                  </form>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {baskets.map((b) => {
                    const filled = b.claims.reduce((s, c) => s + c.portions, 0);
                    return (
                      <div
                        key={b.id}
                        className="rounded-lg border border-line p-3"
                      >
                        <p className="text-sm font-medium text-ink">{b.title}</p>
                        <p className="text-xs text-muted">
                          by {b.organiser.name}
                        </p>
                        <div className="mt-2">
                          <FillMeter filled={filled} total={unit} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
