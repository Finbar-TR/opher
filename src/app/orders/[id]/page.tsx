import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP, savings } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { requestBaseUrl } from "@/lib/base-url";
import { OrderStatusBadge, DeliveryTimeline } from "@/components/ui";
import { payShareAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { paid } = await searchParams;

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

  const myPayment = order.payments.find((p) => p.userId === user.id);
  const isParticipant = Boolean(myPayment);
  if (!isParticipant && user.role !== "operator") notFound();

  const totalPortions = order.payments.reduce((s, p) => s + p.portions, 0);
  const totalAmount = order.payments.reduce((s, p) => s + p.amount, 0);
  const allPaid = order.payments.every((p) => p.status === "paid");

  const sv = savings(
    order.commodity.pricePerPortion,
    order.commodity.shopPricePerPortion
  );
  const totalSavings = sv ? sv.perPortion * totalPortions : 0;
  const appUrl = await requestBaseUrl();
  const shareText = `We saved ${formatGBP(totalSavings)} bulk-buying ${order.commodity.name} together on Opher! ${appUrl}/catalog/${order.commodityId}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/orders" className="text-sm text-muted hover:underline">
          ← Orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-ink">{order.commodity.name}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-muted">
          {order.bulkUnits} × {order.commodity.bulkUnitLabel} · {totalPortions}{" "}
          portions · {formatGBP(totalAmount)} total
        </p>
        {order.status === "pending_payment" && order.paymentDueAt && (
          <p className="mt-1 text-sm text-accent-600">
            Pay by {formatDate(order.paymentDueAt)} or the order is cancelled and
            refunded.
          </p>
        )}
        {order.status !== "cancelled" && order.estimatedDeliveryAt && (
          <p className="mt-1 text-sm text-brand-700">
            Estimated delivery by {formatDate(order.estimatedDeliveryAt)}.
          </p>
        )}
      </div>

      {totalSavings > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-400 bg-accent-400/10 px-4 py-3">
          <p className="text-sm font-semibold text-accent-600">
            Your group saved {formatGBP(totalSavings)} vs shop prices. 🎉
          </p>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary py-2"
          >
            Share on WhatsApp
          </a>
        </div>
      )}

      {paid && myPayment?.status === "paid" && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          Thanks — your share is paid. You&apos;ll see delivery updates below.
        </div>
      )}

      {/* Your share */}
      {myPayment && (
        <div className="card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Your share
          </h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink">
              {myPayment.portions} portion(s) ·{" "}
              <span className="font-semibold">{formatGBP(myPayment.amount)}</span>
              {myPayment.deliveryFee > 0 ? (
                <span className="text-xs text-muted">
                  {" "}
                  (incl. {formatGBP(myPayment.deliveryFee)} delivery)
                </span>
              ) : order.commodity.deliveryFee > 0 ? (
                <span className="text-xs text-brand-700"> · delivery free (organiser)</span>
              ) : null}
            </p>
            {myPayment.status === "paid" ? (
              <span className="badge bg-brand-100 text-brand-800">Paid</span>
            ) : order.status === "pending_payment" ? (
              <form action={payShareAction}>
                <input type="hidden" name="paymentId" value={myPayment.id} />
                <button type="submit" className="btn-primary">
                  Pay {formatGBP(myPayment.amount)}
                </button>
              </form>
            ) : (
              <span className="badge bg-line text-muted">Payment closed</span>
            )}
          </div>
        </div>
      )}

      {/* Participants / payment status */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Participants
        </h2>
        <table className="mt-3 w-full text-left text-sm">
          <tbody className="divide-y divide-line">
            {order.payments.map((p) => (
              <tr key={p.id}>
                <td className="py-2 text-ink">
                  {p.user.name}
                  {p.userId === user.id && (
                    <span className="ml-2 text-xs text-muted">(you)</span>
                  )}
                </td>
                <td className="py-2 text-muted">{p.portions} portion(s)</td>
                <td className="py-2 text-right">
                  <span
                    className={`badge ${
                      p.status === "paid"
                        ? "bg-brand-100 text-brand-800"
                        : "bg-accent-400/30 text-accent-600"
                    }`}
                  >
                    {p.status === "paid" ? "Paid" : "Due"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!allPaid && order.status === "pending_payment" && (
          <p className="mt-3 text-xs text-muted">
            The order is bought once every share is paid.
          </p>
        )}
      </div>

      {/* Delivery tracking */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Delivery
        </h2>
        <div className="mt-4">
          <DeliveryTimeline status={order.status} events={order.events} />
        </div>
      </div>
    </div>
  );
}
