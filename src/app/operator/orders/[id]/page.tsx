import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  OrderStatusBadge,
  DeliveryTimeline,
} from "@/components/ui";
import {
  FULFILMENT_STEPS,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/constants";
import { advanceOrderAction, cancelOrderAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function OperatorOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOperator();
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      commodity: true,
      payments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      baskets: true,
    },
  });
  if (!order) notFound();

  const total = order.payments.reduce((s, p) => s + p.amount, 0);
  const paidCount = order.payments.filter((p) => p.status === "paid").length;
  const idx = FULFILMENT_STEPS.indexOf(order.status as OrderStatus);
  const nextStep =
    idx >= 0 && idx < FULFILMENT_STEPS.length - 1
      ? FULFILMENT_STEPS[idx + 1]
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/operator/orders" className="text-sm text-muted hover:underline">
          ← All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-ink">{order.commodity.name}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-muted">
          {order.bulkUnits} × {order.commodity.bulkUnitLabel} · {formatGBP(total)}{" "}
          · {paidCount}/{order.payments.length} shares paid
        </p>
        {order.status === "pending_payment" && order.paymentDueAt && (
          <p className="mt-1 text-sm text-muted">
            Auto-cancels & refunds if unpaid by {formatDate(order.paymentDueAt)}.
          </p>
        )}
      </div>

      {/* Fulfilment control */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Advance fulfilment
        </h2>
        {order.status === "pending_payment" ? (
          <p className="mt-3 text-sm text-muted">
            Waiting for all shares to be paid before fulfilment can begin.
          </p>
        ) : nextStep ? (
          <form action={advanceOrderAction} className="mt-3 space-y-3">
            <input type="hidden" name="orderId" value={order.id} />
            <div>
              <label className="label" htmlFor="note">
                Note (optional)
              </label>
              <input
                id="note"
                name="note"
                className="input"
                placeholder="e.g. Collected from supplier, ETA Thursday"
              />
            </div>
            <button type="submit" className="btn-accent">
              Mark as {ORDER_STATUS_LABELS[nextStep]}
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-brand-700">
            This order is fully delivered. 🎉
          </p>
        )}
      </div>

      {/* Participants */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Participants ({order.baskets.length} basket
          {order.baskets.length === 1 ? "" : "s"} merged)
        </h2>
        <div className="mt-3 divide-y divide-line">
          {order.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  {p.user.name}{" "}
                  <span className="font-normal text-muted">· {p.user.email}</span>
                </p>
                <p className="text-sm text-muted">
                  {p.portions} portion(s) · deliver to:{" "}
                  {p.deliveryAddress || p.user.phone ? (
                    <span className="text-ink">
                      {p.deliveryAddress ?? "—"}
                      {p.user.phone ? ` · ${p.user.phone}` : ""}
                    </span>
                  ) : (
                    <span className="text-red-600">no address on file</span>
                  )}
                </p>
              </div>
              <span
                className={`badge ${
                  p.status === "paid"
                    ? "bg-brand-100 text-brand-800"
                    : p.status === "refunded"
                      ? "bg-line text-muted"
                      : "bg-accent-400/30 text-accent-600"
                }`}
              >
                {p.status === "paid" ? "Paid" : p.status === "refunded" ? "Refunded" : "Due"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Delivery history
        </h2>
        <div className="mt-4">
          <DeliveryTimeline status={order.status} events={order.events} />
        </div>
      </div>

      {/* Cancel / refund */}
      {order.status !== "delivered" && order.status !== "cancelled" && (
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">
            Cancel order
          </h2>
          <p className="mt-1 text-sm text-muted">
            Refunds every paid share and releases the baskets. Use this to unstick an
            order where members haven&apos;t all paid.
          </p>
          <form action={cancelOrderAction} className="mt-3 space-y-3">
            <input type="hidden" name="orderId" value={order.id} />
            <input
              name="reason"
              className="input"
              placeholder="Reason (optional)"
            />
            <button type="submit" className="btn-danger">
              Cancel &amp; refund
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
