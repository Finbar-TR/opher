import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { OrderStatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { payments: { some: { userId: user.id } } },
    include: {
      commodity: true,
      payments: { where: { userId: user.id } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Orders</h1>
      <p className="mt-1 text-muted">Bulk buys you&apos;re part of, and their delivery.</p>

      {orders.length === 0 ? (
        <div className="card mt-6 text-center text-muted">
          No orders yet. Orders appear once your basket merges into a whole unit.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((o) => {
            const mine = o.payments[0];
            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="card flex flex-wrap items-center justify-between gap-3 hover:shadow-md"
              >
                <div>
                  <p className="font-semibold text-ink">{o.commodity.name}</p>
                  <p className="text-sm text-muted">
                    Your share: {mine.portions} portion(s) ·{" "}
                    {formatGBP(mine.amount)} ·{" "}
                    <span
                      className={
                        mine.status === "paid"
                          ? "text-brand-700"
                          : "text-accent-600"
                      }
                    >
                      {mine.status === "paid" ? "Paid" : "Payment due"}
                    </span>
                  </p>
                </div>
                <OrderStatusBadge status={o.status} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
