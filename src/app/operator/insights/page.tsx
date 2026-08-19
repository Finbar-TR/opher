import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP, savings } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await requireOperator();

  const [openBaskets, orders, commodities] = await Promise.all([
    prisma.basket.findMany({
      where: { status: "open" },
      include: { commodity: true, claims: true },
    }),
    prisma.order.findMany({
      include: { commodity: true, payments: true },
    }),
    prisma.commodity.count(),
  ]);

  const portionsOf = (claims: { portions: number }[]) =>
    claims.reduce((s, c) => s + c.portions, 0);

  // Open demand by category and by zone.
  const byCategory = new Map<string, number>();
  const byZone = new Map<string, number>();
  for (const b of openBaskets) {
    const p = portionsOf(b.claims);
    byCategory.set(b.commodity.category, (byCategory.get(b.commodity.category) ?? 0) + p);
    const z = b.outwardCode ?? "—";
    byZone.set(z, (byZone.get(z) ?? 0) + p);
  }

  // Orders (drops) per zone and total savings delivered.
  const dropsByZone = new Map<string, number>();
  let savingsDelivered = 0;
  const fulfilled = new Set(["paid", "bought", "out_for_delivery", "delivered"]);
  for (const o of orders) {
    const z = o.outwardCode ?? "—";
    dropsByZone.set(z, (dropsByZone.get(z) ?? 0) + 1);
    if (fulfilled.has(o.status)) {
      const sv = savings(o.commodity.pricePerPortion, o.commodity.shopPricePerPortion);
      if (sv) {
        savingsDelivered += sv.perPortion * o.payments.reduce((s, p) => s + p.portions, 0);
      }
    }
  }

  const delivered = orders.filter((o) => o.status === "delivered").length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/operator" className="text-sm text-muted hover:underline">
          ← Operator
        </Link>
        <h1 className="mt-2 font-display text-[38px] leading-tight text-ink">Insights</h1>
        <p className="mt-1 text-muted">Where demand is building, and what to launch next.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Commodities" value={commodities} />
        <Stat label="Open baskets" value={openBaskets.length} />
        <Stat label="Orders" value={orders.length} />
        <Stat label="Savings delivered" value={formatGBP(savingsDelivered)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Breakdown title="Open demand by category (portions)" rows={byCategory} />
        <Breakdown title="Open demand by zone (portions)" rows={byZone} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Breakdown title="Orders per zone (drops)" rows={dropsByZone} />
        <Stat label="Delivered orders" value={delivered} big />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: string | number;
  big?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 font-bold text-ink ${big ? "text-4xl" : "text-3xl"}`}>{value}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Map<string, number> }) {
  const entries = [...rows.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span className="text-ink">{k}</span>
              <span className="font-medium text-brand-700">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
