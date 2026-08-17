import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { getCurrentUser } from "@/lib/auth";
import { CommodityThumb } from "../page";

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

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/catalog" className="text-sm text-muted hover:underline">
        ← Back to catalog
      </Link>

      <div className="mt-4 grid gap-8 sm:grid-cols-2">
        <CommodityThumb name={commodity.name} imageUrl={commodity.imageUrl} />
        <div>
          <h1 className="text-3xl font-bold text-ink">{commodity.name}</h1>
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
            <Row label="Full bulk unit">{formatGBP(bulkPrice)}</Row>
          </dl>

          <div className="mt-8">
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
