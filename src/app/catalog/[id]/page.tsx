import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { getCurrentUser } from "@/lib/auth";
import { CommodityThumb } from "../page";
import { SavingsBadge, NoFillNoFee, FillMeter } from "@/components/ui";

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

  // Public open baskets for this item that others can join right now — beats
  // starting a lonely basket and directly fights the "empty app" problem.
  const joinable = user
    ? await prisma.basket.findMany({
        where: {
          commodityId: id,
          status: "open",
          visibility: "public",
          orderId: null,
        },
        include: { claims: true, organiser: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/catalog" className="text-sm text-muted hover:underline">
        ← Back to catalog
      </Link>

      <div className="mt-4 grid gap-8 sm:grid-cols-2">
        <CommodityThumb name={commodity.name} imageUrl={commodity.imageUrl} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-brand-100 text-brand-800">
              {commodity.category}
            </span>
            <SavingsBadge
              pricePerPortion={commodity.pricePerPortion}
              shopPricePerPortion={commodity.shopPricePerPortion}
            />
          </div>
          <h1 className="mt-2 text-3xl font-bold text-ink">{commodity.name}</h1>
          <p className="mt-2 text-muted">{commodity.description}</p>

          <dl className="mt-6 space-y-3 text-sm">
            <Row label="Bulk unit">{commodity.bulkUnitLabel}</Row>
            <Row label="Portions per bulk unit">
              {commodity.portionsPerBulkUnit}
            </Row>
            <Row label="Measured in">{commodity.baseUnit}</Row>
            <Row label="Price per portion">
              <span className="font-semibold text-brand-700">
                {formatGBP(commodity.pricePerPortion)}
              </span>
            </Row>
            {commodity.shopPricePerPortion != null && (
              <Row label="Typical shop price">
                <span className="text-muted line-through">
                  {formatGBP(commodity.shopPricePerPortion)}
                </span>
              </Row>
            )}
            <Row label="Full bulk unit">{formatGBP(bulkPrice)}</Row>
            <Row label="Delivery">
              ~{commodity.deliveryLeadDays} days after the basket completes
            </Row>
          </dl>

          <div className="mt-6">
            <NoFillNoFee />
          </div>

          <div className="mt-6">
            {user ? (
              <Link
                href={`/baskets/new?commodityId=${commodity.id}`}
                className="btn-primary w-full"
              >
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
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-ink">Or join an open basket</h2>
          <p className="mt-1 text-sm text-muted">
            These groups are already buying {commodity.name} — hop in.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {joinable.map((b) => {
              const filled = b.claims.reduce((s, c) => s + c.portions, 0);
              return (
                <Link key={b.id} href={`/baskets/${b.id}`} className="card hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{b.title}</p>
                    <span className="text-xs text-muted">by {b.organiser.name}</span>
                  </div>
                  <div className="mt-3">
                    <FillMeter filled={filled} total={b.targetPortions} />
                  </div>
                </Link>
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
    <div className="flex items-center justify-between border-b border-line pb-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}
