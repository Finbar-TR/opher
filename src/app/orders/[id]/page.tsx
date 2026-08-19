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
          <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
            {order.commodity.name}
          </h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-1 text-soft">
          {order.bulkUnits} × {order.commodity.bulkUnitLabel} · {totalPortions}{" "}
          portions · {formatGBP(totalAmount)} total
        </p>
        {order.status === "pending_payment" && order.paymentDueAt && (
          <p className="mt-1 text-sm font-semibold text-tomato">
            Pay by {formatDate(order.paymentDueAt)} or the order is cancelled and
            refunded.
          </p>
        )}
        {order.status !== "cancelled" && order.estimatedDeliveryAt && (
          <p className="mt-1 text-sm text-saffron-ink">
            Estimated delivery by {formatDate(order.estimatedDeliveryAt)}.
          </p>
        )}
      </div>

      {totalSavings > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-saffron px-5 py-4">
          <p className="font-display text-[26px] text-saffron-ink">
            Your group saved{" "}
            <span className="font-sans font-extrabold text-tomato">
              {formatGBP(totalSavings)}
            </span>{" "}
            against shop prices.
          </p>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn text-[#fffaf3]"
            style={{ background: "#25a35a" }}
          >
            Share on WhatsApp
          </a>
        </div>
      )}

      {paid && myPayment?.status === "paid" && (
        <div className="rounded-2xl bg-saffron px-4 py-3 text-sm text-saffron-ink">
          Thanks — your share is paid. You&apos;ll see delivery updates below.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          {/* Your share */}
          {myPayment && (
            <div className="card">
              <h2 className="eyebrow">Your share</h2>
              <p className="mt-2 font-display text-[42px] leading-none text-ink">
                {formatGBP(myPayment.amount)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {myPayment.portions} portion(s)
                {myPayment.deliveryFee > 0
                  ? ` · incl. ${formatGBP(myPayment.deliveryFee)} delivery`
                  : order.commodity.deliveryFee > 0
                    ? " · delivery free (organiser)"
                    : ""}
              </p>
              <div className="mt-4">
                {myPayment.status === "paid" ? (
                  <span className="badge bg-saffron text-saffron-ink">Paid</span>
                ) : order.status === "pending_payment" ? (
                  <form action={payShareAction}>
                    <input type="hidden" name="paymentId" value={myPayment.id} />
                    <button type="submit" className="btn-primary w-full">
                      Pay {formatGBP(myPayment.amount)}
                    </button>
                  </form>
                ) : (
                  <span className="badge bg-line-soft text-soft">Payment closed</span>
                )}
              </div>
            </div>
          )}

          {/* Participants */}
          <div className="card">
            <h2 className="eyebrow">Participants</h2>
            <table className="mt-3 w-full text-left text-sm">
              <tbody className="divide-y divide-line-soft">
                {order.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 font-semibold text-ink">
                      {p.user.name}
                      {p.userId === user.id && (
                        <span className="ml-2 text-xs text-soft">(you)</span>
                      )}
                    </td>
                    <td className="py-2.5 text-soft">{p.portions} portion(s)</td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${
                          p.status === "paid"
                            ? "bg-saffron text-saffron-ink"
                            : "bg-tomato text-[#fffaf3]"
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
              <p className="mt-3 text-xs text-soft">
                The order is bought once every share is paid.
              </p>
            )}
          </div>
        </div>

        {/* Delivery — roast panel */}
        <div className="rounded-3xl p-6" style={{ background: "#7c2d12" }}>
          <div className="flex items-center justify-between">
            <span className="eyebrow" style={{ color: "#e0a86a" }}>
              Delivery
            </span>
            {order.estimatedDeliveryAt && (
              <span className="text-xs text-[#e0a86a]">
                Est. {formatDate(order.estimatedDeliveryAt)}
              </span>
            )}
          </div>
          <div className="mt-5">
            <DeliveryTimeline status={order.status} events={order.events} onDark />
          </div>
        </div>
      </div>
    </div>
  );
}
