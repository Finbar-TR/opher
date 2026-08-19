import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { getCurrentUser } from "@/lib/auth";
import { PhotoSlot, SavingsBadge, NoFillNoFee } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CommodityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [commodity, user] = await Promise.all([
    prisma.commodity.findUnique({ where: { id } }),
    getCurrentUser(),
  ]);

  if (!commodity || !commodity.active) notFound();

  const bulkPrice = commodity.pricePerPortion * commodity.portionsPerBulkUnit;

  const joinable = user
    ? await prisma.basket.findMany({
        where: { commodityId: id, status: "open", visibility: "public", orderId: null },
        include: { claims: true, organiser: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/catalog" className="text-sm font-semibold text-soft hover:underline">
        ← Back to catalog
      </Link>

      <div className="mt-4 grid gap-8 sm:grid-cols-2">
        <div className="space-y-5">
          <PhotoSlot
            caption={commodity.name}
            imageUrl={commodity.imageUrl}
            className="h-[300px] w-full rounded-3xl"
          />
          {/* Bulk maths — roast panel */}
          <div className="rounded-3xl p-6" style={{ background: "#7c2d12" }}>
            <p className="eyebrow" style={{ color: "#e0a86a" }}>
              Bulk maths
            </p>
            <p className="mt-2 font-display text-[40px] leading-none text-[#fffaf3]">
              {formatGBP(bulkPrice)}
            </p>
            <p className="mt-2 text-sm text-[#e0a86a]">
              full {commodity.bulkUnitLabel} · {commodity.portionsPerBulkUnit} portions ·{" "}
              {formatGBP(commodity.pricePerPortion)} each
            </p>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-saffron text-saffron-ink">{commodity.category}</span>
            <SavingsBadge
              pricePerPortion={commodity.pricePerPortion}
              shopPricePerPortion={commodity.shopPricePerPortion}
            />
          </div>
          <h1 className="mt-2 font-display text-[44px] leading-tight text-ink sm:text-[52px]">
            {commodity.name}
          </h1>
          <p className="mt-2 text-muted">{commodity.description}</p>

          <dl className="mt-6 text-sm">
            <Row label="Bulk unit">{commodity.bulkUnitLabel}</Row>
            <Row label="Portions per bulk unit">{commodity.portionsPerBulkUnit}</Row>
            <Row label="Measured in">{commodity.baseUnit}</Row>
            <Row label="Price per portion">
              <span className="font-bold text-tomato">
                {formatGBP(commodity.pricePerPortion)}
              </span>
            </Row>
            {commodity.shopPricePerPortion != null && (
              <Row label="Typical shop price">
                <span className="text-soft line-through">
                  {formatGBP(commodity.shopPricePerPortion)}
                </span>
              </Row>
            )}
            <Row label="Delivery">
              ~{commodity.deliveryLeadDays} days after the basket completes
            </Row>
          </dl>

          <div className="mt-6">
            <NoFillNoFee />
          </div>

          <div className="mt-6">
            {user ? (
              <Link href={`/baskets/new?commodityId=${commodity.id}`} className="btn-primary w-full">
                Start a basket
              </Link>
            ) : (
              <Link href="/sign-in" className="btn-primary w-full">
                Sign in to start a basket
              </Link>
            )}
          </div>
        </div>
      </div>

      {joinable.length > 0 && (
        <div className="mt-12">
          <h2 className="font-display text-[28px] text-ink sm:text-[32px]">
            Or join a basket that&apos;s already filling
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {joinable.map((b) => {
              const filled = b.claims.reduce((s, c) => s + c.portions, 0);
              return (
                <div key={b.id} className="card">
                  <p className="text-[17px] font-bold text-ink">{b.title}</p>
                  <p className="text-sm text-soft">by {b.organiser.name}</p>
                  <div className="mt-3 flex gap-1.5">
                    {Array.from({ length: b.targetPortions }).map((_, i) => (
                      <span
                        key={i}
                        className="h-7 w-4 rounded-[3px]"
                        style={{ background: i < filled ? "#d6432c" : "#eeddcb" }}
                      />
                    ))}
                  </div>
                  <Link href={`/baskets/${b.id}`} className="btn-accent mt-4 w-full">
                    Join this basket
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-3">
      <dt className="text-soft">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}
