import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { OrderStatusBadge, PhotoSlot } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser();

  const orders = await prisma.order.findMany({
    where: { payments: { some: { userId: user.id } } },
    include: { commodity: true, payments: { where: { userId: user.id } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
        Orders
      </h1>
      <p className="mt-1 text-muted">Bulk buys you&apos;re part of, and their delivery.</p>

      {orders.length === 0 ? (
        <div className="card mt-6 text-center text-soft">
          No orders yet. Orders appear once your basket merges into a whole unit.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((o) => {
            const mine = o.payments[0];
            const needsPay =
              mine.status !== "paid" && o.status === "pending_payment";
            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="flex items-center gap-4 rounded-[22px] border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-[0_8px_20px_rgba(122,60,20,0.10)]"
              >
                <PhotoSlot
                  caption={o.commodity.name}
                  imageUrl={o.commodity.imageUrl}
                  className="h-[76px] w-[76px] shrink-0 rounded-2xl"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[22px] leading-tight text-ink sm:text-[26px]">
                    {o.commodity.name}
                  </p>
                  <p className="text-sm text-soft">
                    {o.bulkUnits} × {o.commodity.bulkUnitLabel} · your share{" "}
                    {mine.portions} portion(s) · {formatGBP(mine.amount)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {mine.status === "paid" ? (
                      <span className="inline-flex items-center rounded-full bg-saffron px-3 py-1 text-[11px] font-bold text-saffron-ink">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-tomato px-3 py-1 text-[11px] font-bold text-[#fffaf3]">
                        {o.paymentDueAt ? `Pay by ${formatDate(o.paymentDueAt)}` : "Payment due"}
                      </span>
                    )}
                    <OrderStatusBadge status={o.status} />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold text-tomato">
                  {needsPay ? `Pay ${formatGBP(mine.amount)} →` : "Track →"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
