import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getUserOrder } from "@/lib/basket-views";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { cancelOrderAction } from "../actions";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ joined?: string; cancelFailed?: string }>;
}) {
  const { id } = await params;
  const { joined, cancelFailed } = await searchParams;
  const user = await requireUser();
  const order = await getUserOrder(id, user.id);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/orders" className="text-sm text-muted hover:underline">← Your baskets</Link>

      {joined === "1" && (
        <div className="rounded-xl border border-line bg-brand-50 p-4">
          <p className="font-display text-2xl text-ink">You&apos;re in!</p>
          <p className="mt-1 text-muted">
            We&apos;ll charge your card on {formatWeekday(order.cancellationDeadline)}.
          </p>
        </div>
      )}

      {cancelFailed === "1" && (
        <p className="rounded-xl border border-line bg-saffron p-4 text-sm font-medium text-saffron-ink">
          We couldn&apos;t cancel this order — its basket has now closed and payment is already
          being taken. You&apos;ll get a receipt shortly.
        </p>
      )}

      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] leading-tight text-ink">{order.productName}</h1>
            <p className="mt-1 text-muted">{order.city} · {order.tierLabel}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        <dl className="mt-5 space-y-2 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-muted">Price</dt>
            <dd className="font-semibold text-ink">{formatGBP(order.totalPence)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Delivery</dt>
            <dd className="text-ink">{formatWeekday(order.deliveryDate)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">
              {order.canCancel ? "Card charged on" : "Charge date"}
            </dt>
            <dd className="text-ink">{formatWeekday(order.cancellationDeadline)}</dd>
          </div>
        </dl>
      </div>

      {order.canCancel ? (
        <form action={cancelOrderAction} className="card">
          <input type="hidden" name="orderId" value={order.id} />
          <p className="text-[15px] text-muted">
            You can cancel free until{" "}
            <strong className="text-ink">{formatWeekday(order.cancellationDeadline)}</strong>.
            After that your card is charged and the order is on its way.
          </p>
          <button type="submit" className="btn-secondary mt-4">Cancel this order</button>
        </form>
      ) : order.status === "committed" ? (
        <p className="text-sm text-muted">
          The cancellation deadline has passed — your card is being charged.
        </p>
      ) : null}
    </div>
  );
}
