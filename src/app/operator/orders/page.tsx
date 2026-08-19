import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { OrderStatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OperatorOrdersPage() {
  await requireOperator();

  const orders = await prisma.order.findMany({
    include: { commodity: true, payments: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6">
        <Link href="/operator" className="text-sm text-muted hover:underline">
          ← Operator
        </Link>
        <h1 className="mt-2 font-display text-[38px] leading-tight text-ink">Orders</h1>
        <p className="mt-1 text-muted">Fulfil bulk buys and update delivery.</p>
      </div>

      {orders.length === 0 ? (
        <div className="card text-center text-muted">No orders yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-brand-50 text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Commodity</th>
                <th className="px-4 py-3 font-medium">Participants</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {orders.map((o) => {
                const paidCount = o.payments.filter(
                  (p) => p.status === "paid"
                ).length;
                const total = o.payments.reduce((s, p) => s + p.amount, 0);
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      {o.commodity.name}
                    </td>
                    <td className="px-4 py-3 text-muted">{o.payments.length}</td>
                    <td className="px-4 py-3 text-muted">
                      {paidCount}/{o.payments.length}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatGBP(total)}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/operator/orders/${o.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
