import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { CommodityForm } from "../commodity-form";
import { createCommodityAction } from "../../actions";

export default async function NewCommodityPage() {
  await requireOperator();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/operator/commodities" className="text-sm text-muted hover:underline">
        ← Back to commodities
      </Link>
      <h1 className="mb-6 mt-4 text-3xl font-bold text-ink">Add commodity</h1>
      <CommodityForm action={createCommodityAction} submitLabel="Create commodity" />
    </div>
  );
}
