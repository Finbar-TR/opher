import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function OperatorHome() {
  await requireOperator();

  const [commodities, openBaskets, orders] = await Promise.all([
    prisma.commodity.count(),
    prisma.basket.count({ where: { status: "committed", orderId: null } }),
    prisma.order.count(),
  ]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Operator</h1>
      <p className="mt-1 text-muted">Manage the catalog, demand, and fulfilment.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Link href="/operator/commodities" className="card hover:shadow-md">
          <p className="text-sm text-muted">Commodities</p>
          <p className="mt-1 text-3xl font-bold text-ink">{commodities}</p>
          <p className="mt-2 text-sm text-brand-700">Manage catalog →</p>
        </Link>
        <Link href="/operator/demand" className="card hover:shadow-md">
          <p className="text-sm text-muted">Committed baskets awaiting merge</p>
          <p className="mt-1 text-3xl font-bold text-ink">{openBaskets}</p>
          <p className="mt-2 text-sm text-brand-700">Review demand →</p>
        </Link>
        <Link href="/operator/orders" className="card hover:shadow-md">
          <p className="text-sm text-muted">Orders</p>
          <p className="mt-1 text-3xl font-bold text-ink">{orders}</p>
          <p className="mt-2 text-sm text-brand-700">Fulfil orders →</p>
        </Link>
        <Link href="/operator/zones" className="card hover:shadow-md">
          <p className="text-sm text-muted">Delivery zones</p>
          <p className="mt-2 text-sm text-brand-700">Manage launch areas →</p>
        </Link>
        <Link href="/operator/insights" className="card hover:shadow-md">
          <p className="text-sm text-muted">Insights</p>
          <p className="mt-2 text-sm text-brand-700">Demand &amp; savings →</p>
        </Link>
      </div>
    </div>
  );
}
