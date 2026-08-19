import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProgressBar } from "@/components/ui";
import { FULFILMENT_STEPS, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function OperatorHome() {
  await requireOperator();

  const [commodities, committed, ordersCount, orders] = await Promise.all([
    prisma.commodity.count(),
    prisma.basket.findMany({
      where: { status: "committed", orderId: null },
      include: { commodity: true, claims: true },
    }),
    prisma.order.count(),
    prisma.order.findMany({
      where: { status: { in: FULFILMENT_STEPS } },
      include: { commodity: true },
      orderBy: { createdAt: "asc" },
      take: 1,
    }),
  ]);

  // Demand grouped by commodity: total committed portions vs one bulk unit.
  const demand = new Map<
    string,
    { name: string; bulkUnitLabel: string; unit: number; portions: number }
  >();
  for (const b of committed) {
    const e = demand.get(b.commodityId) ?? {
      name: b.commodity.name,
      bulkUnitLabel: b.commodity.bulkUnitLabel,
      unit: b.commodity.portionsPerBulkUnit,
      portions: 0,
    };
    e.portions += b.claims.reduce((s, c) => s + c.portions, 0);
    demand.set(b.commodityId, e);
  }
  const demandRows = [...demand.values()]
    .sort((a, b) => (b.portions % b.unit) - (a.portions % a.unit))
    .slice(0, 4);

  const nextOrder = orders[0];
  const nextIdx = nextOrder
    ? FULFILMENT_STEPS.indexOf(nextOrder.status as OrderStatus)
    : -1;
  const nextStepLabel =
    nextIdx >= 0 && nextIdx < FULFILMENT_STEPS.length - 1
      ? ORDER_STATUS_LABELS[FULFILMENT_STEPS[nextIdx + 1]]
      : null;

  return (
    <div>
      <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
        Today in the kitchen
      </h1>

      {/* Stats */}
      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Link
          href="/operator/demand"
          className="rounded-[22px] p-6 transition hover:brightness-105"
          style={{ background: "#7c2d12" }}
        >
          <p className="text-sm text-[#e0a86a]">Committed, awaiting merge</p>
          <p className="mt-1 font-display text-[56px] leading-none text-[#fffaf3]">
            {committed.length}
          </p>
          <p className="mt-2 text-sm font-bold text-[#f0844c]">Review demand →</p>
        </Link>
        <Link href="/operator/commodities" className="card hover:border-line-strong">
          <p className="text-sm text-soft">Commodities</p>
          <p className="mt-1 font-display text-[56px] leading-none text-ink">{commodities}</p>
          <p className="mt-2 text-sm font-bold text-tomato">Manage catalog →</p>
        </Link>
        <Link href="/operator/orders" className="card hover:border-line-strong">
          <p className="text-sm text-soft">Orders</p>
          <p className="mt-1 font-display text-[56px] leading-none text-ink">{ordersCount}</p>
          <p className="mt-2 text-sm font-bold text-tomato">Fulfil orders →</p>
        </Link>
      </div>

      {/* Demand + next step */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="card">
          <h2 className="eyebrow">Demand close to a whole unit</h2>
          {demandRows.length === 0 ? (
            <p className="mt-3 text-sm text-soft">No committed baskets right now.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {demandRows.map((d) => {
                const inUnit = d.portions % d.unit || (d.portions >= d.unit ? d.unit : d.portions);
                const ready = d.portions >= d.unit;
                return (
                  <li key={d.name} className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">{d.name}</p>
                      <p className="text-xs text-soft">{d.bulkUnitLabel}</p>
                      <div className="mt-2">
                        <ProgressBar filled={inUnit} total={d.unit} className="h-3" />
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-sm font-bold text-ink">
                      {inUnit}/{d.unit}
                    </span>
                    <Link
                      href="/operator/demand"
                      className={
                        ready
                          ? "badge bg-saffron text-saffron-ink"
                          : "badge border border-line-strong text-soft"
                      }
                    >
                      {ready ? "Merge now" : "Waiting"}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="eyebrow">Next fulfilment step</h2>
          {nextOrder && nextStepLabel ? (
            <div className="mt-3">
              <p className="font-display text-[26px] text-ink">{nextOrder.commodity.name}</p>
              <p className="mt-1 text-sm text-soft">
                Currently {ORDER_STATUS_LABELS[nextOrder.status as OrderStatus]}
              </p>
              <Link
                href={`/operator/orders/${nextOrder.id}`}
                className="btn-primary mt-4 w-full"
              >
                Mark {nextStepLabel}
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-soft">Nothing waiting on fulfilment. 🎉</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <Link href="/operator/zones" className="btn-secondary">
          Delivery zones
        </Link>
        <Link href="/operator/insights" className="btn-secondary">
          Insights
        </Link>
      </div>
    </div>
  );
}
