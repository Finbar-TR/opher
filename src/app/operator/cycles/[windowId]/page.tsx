import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWindowOrders } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { refundOrderAction, refundWindowAction } from "./actions";
import { formatGBP } from "@/lib/money";
import { formatWeekday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function WindowOrdersPage({
  params,
}: {
  params: Promise<{ windowId: string }>;
}) {
  await requireOperator();
  const { windowId } = await params;

  const window = await prisma.deliveryWindow.findUnique({
    where: { id: windowId },
    include: { city: true },
  });
  if (!window) notFound();

  const orders = await listWindowOrders(windowId);
  const refundable = orders.filter((o) => o.canRefund);
  // What was taken. Every `paid` order counts, including one whose payment
  // intent went missing — the customer was still charged.
  const takings = orders
    .filter((o) => o.status === "paid")
    .reduce((sum, o) => sum + o.totalPence, 0);
  // What will actually move if the operator refunds the window. An order with
  // no intent id cannot be refunded through Stripe, so naming it in an
  // irreversible confirmation would promise money that stays put.
  const refundableTotal = refundable.reduce((sum, o) => sum + o.totalPence, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="cycles" />
      <Link href="/operator/cycles" className="text-sm text-muted hover:underline">
        ← What to buy
      </Link>

      <h1 className="mt-2 font-display text-[32px] leading-tight text-ink">
        {window.city.name} — {formatWeekday(window.deliveryDate)}
      </h1>
      <p className="mt-1 text-muted">
        {orders.length === 1 ? "1 order" : `${orders.length} orders`} ·{" "}
        {formatGBP(takings)} taken
      </p>

      {refundable.length > 0 && (
        <form action={refundWindowAction} className="card mt-6">
          <p className="text-[15px] text-muted">
            Pulling this delivery? This refunds{" "}
            <strong className="text-ink">every food</strong> in{" "}
            {window.city.name}&apos;s run, not just the one you arrived from —{" "}
            <strong className="text-ink">{formatGBP(refundableTotal)}</strong> to{" "}
            {refundable.length === 1 ? "1 customer" : `${refundable.length} customers`}.
            This cannot be undone. To pull one food, refund its orders
            individually below.
          </p>
          <input type="hidden" name="windowId" value={windowId} />
          <button type="submit" className="btn-danger mt-3">
            Refund every paid order
          </button>
        </form>
      )}

      <div className="mt-8 divide-y divide-line rounded-xl border border-line bg-surface">
        {orders.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium text-ink">
                {o.userName} · {o.productName}
              </p>
              <p className="text-sm text-muted">{o.userEmail} · {o.tierLabel}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-ink">{formatGBP(o.totalPence)}</span>
              <OrderStatusBadge status={o.status} />
              {o.canRefund && (
                <form action={refundOrderAction}>
                  <input type="hidden" name="orderId" value={o.id} />
                  <input type="hidden" name="windowId" value={windowId} />
                  {/* Danger styling, not a text link: this moves money and
                      cannot be undone, so it must not look like the navigation
                      link two lines up. */}
                  <button type="submit" className="btn-danger">
                    Refund
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
