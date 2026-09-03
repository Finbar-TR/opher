import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listUserOrders } from "@/lib/basket-views";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await listUserOrders(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="font-display text-[38px] leading-tight text-ink">Your baskets</h1>

      {orders.length === 0 ? (
        <div className="card text-center">
          <p className="font-display text-2xl text-ink">You haven&apos;t joined a basket yet</p>
          <Link href="/baskets" className="btn-primary mt-4 inline-block">Browse baskets</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="card block transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-xl text-ink">{o.productName}</p>
                  <p className="mt-1 text-sm text-muted">
                    {o.city} · {o.tierLabel}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Delivery {formatWeekday(o.deliveryDate)}
                  </p>
                </div>
                <div className="text-right">
                  <OrderStatusBadge status={o.status} />
                  <p className="mt-2 font-semibold text-ink">{formatGBP(o.totalPence)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
