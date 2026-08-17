import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP } from "@/lib/money";
import { toggleCommodityActiveAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function OperatorCommoditiesPage() {
  await requireOperator();
  const commodities = await prisma.commodity.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">Commodities</h1>
          <p className="mt-1 text-muted">The curated catalog members buy from.</p>
        </div>
        <Link href="/operator/commodities/new" className="btn-primary">
          Add commodity
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-50 text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Bulk unit</th>
              <th className="px-4 py-3 font-medium">Portions</th>
              <th className="px-4 py-3 font-medium">Price/portion</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface">
            {commodities.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                <td className="px-4 py-3 text-muted">{c.bulkUnitLabel}</td>
                <td className="px-4 py-3 text-muted">{c.portionsPerBulkUnit}</td>
                <td className="px-4 py-3 text-muted">
                  {formatGBP(c.pricePerPortion)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`badge ${
                      c.active
                        ? "bg-brand-100 text-brand-800"
                        : "bg-line text-muted"
                    }`}
                  >
                    {c.active ? "Active" : "Hidden"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/operator/commodities/${c.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </Link>
                    <form action={toggleCommodityActiveAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="font-medium text-muted hover:underline"
                      >
                        {c.active ? "Hide" : "Show"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {commodities.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No commodities yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
