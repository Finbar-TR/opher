import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BasketForm } from "./basket-form";

export const dynamic = "force-dynamic";

export default async function NewBasketPage({
  searchParams,
}: {
  searchParams: Promise<{ commodityId?: string }>;
}) {
  await requireUser();
  const { commodityId } = await searchParams;

  if (!commodityId) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-ink">Start a basket</h1>
        <p className="mt-2 text-muted">
          Choose a commodity from the{" "}
          <Link href="/catalog" className="text-brand-700 hover:underline">
            catalog
          </Link>{" "}
          to begin.
        </p>
      </div>
    );
  }

  const commodity = await prisma.commodity.findUnique({
    where: { id: commodityId },
  });
  if (!commodity || !commodity.active) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/catalog/${commodity.id}`}
        className="text-sm text-muted hover:underline"
      >
        ← Back to {commodity.name}
      </Link>
      <h1 className="mb-6 mt-4 text-3xl font-bold text-ink">Start a basket</h1>
      <BasketForm
        commodityId={commodity.id}
        commodityName={commodity.name}
        bulkUnitLabel={commodity.bulkUnitLabel}
        portionsPerBulkUnit={commodity.portionsPerBulkUnit}
        pricePerPortion={commodity.pricePerPortion}
      />
    </div>
  );
}
