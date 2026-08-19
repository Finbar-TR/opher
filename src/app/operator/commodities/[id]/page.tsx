import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CommodityForm } from "../commodity-form";
import { updateCommodityAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditCommodityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOperator();
  const { id } = await params;
  const commodity = await prisma.commodity.findUnique({ where: { id } });
  if (!commodity) notFound();

  const action = updateCommodityAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/operator/commodities" className="text-sm text-muted hover:underline">
        ← Back to commodities
      </Link>
      <h1 className="mb-6 mt-4 font-display text-[38px] leading-tight text-ink">Edit {commodity.name}</h1>
      <CommodityForm
        action={action}
        submitLabel="Save changes"
        initial={{
          name: commodity.name,
          description: commodity.description,
          category: commodity.category,
          imageUrl: commodity.imageUrl ?? "",
          baseUnit: commodity.baseUnit,
          bulkUnitLabel: commodity.bulkUnitLabel,
          portionsPerBulkUnit: commodity.portionsPerBulkUnit,
          pricePerPortionPounds: commodity.pricePerPortion / 100,
          shopPricePerPortionPounds:
            commodity.shopPricePerPortion != null
              ? commodity.shopPricePerPortion / 100
              : "",
          deliveryFeePounds: commodity.deliveryFee / 100,
          deliveryLeadDays: commodity.deliveryLeadDays,
        }}
      />
    </div>
  );
}
