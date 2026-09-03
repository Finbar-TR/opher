import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listAdminBaskets } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { BasketForm } from "./basket-form";
import { setBasketStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OperatorBasketsPage() {
  await requireOperator();

  const [rows, cities, skus] = await Promise.all([
    listAdminBaskets(),
    prisma.city.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.sku.findMany({ where: { active: true }, include: { product: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="baskets" />
      <h1 className="font-display text-[38px] leading-tight text-ink">Baskets</h1>
      <p className="mt-1 text-muted">
        One food, one city. Customers join these; delivery dates come from the city.
      </p>

      {skus.length === 0 ? (
        <p className="card mt-6 text-muted">
          Add a food to the catalogue first — a basket has to point at one.
        </p>
      ) : (
        <div className="mt-6">
          <BasketForm
            cities={cities.map((c) => ({ id: c.id, label: c.name }))}
            skus={skus.map((s) => ({ id: s.id, label: `${s.product.name} — ${s.label}` }))}
          />
        </div>
      )}

      <div className="mt-8 space-y-3">
        {rows.map((b) => (
          <div key={b.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl text-ink">{b.label}</p>
                <p className="mt-1 text-sm text-muted">
                  {b.city} · {b.productName} ({b.skuLabel}) · {b.tierCount} sizes
                </p>
                <p className="mt-1 text-sm text-muted">
                  {b.joinersThisCycle === 1 ? "1 joiner" : `${b.joinersThisCycle} joiners`} this cycle
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${b.status === "open" ? "bg-brand-100 text-brand-900" : "bg-saffron text-saffron-ink"}`}>
                  {b.status}
                </span>
                <form action={setBasketStatusAction}>
                  <input type="hidden" name="basketId" value={b.id} />
                  <input type="hidden" name="status" value={b.status === "open" ? "paused" : "open"} />
                  <button type="submit" className="font-medium text-brand-700 hover:underline">
                    {b.status === "open" ? "Pause" : "Resume"}
                  </button>
                </form>
                <form action={setBasketStatusAction}>
                  <input type="hidden" name="basketId" value={b.id} />
                  <input type="hidden" name="status" value="archived" />
                  <button type="submit" className="font-medium text-muted hover:underline">
                    Archive
                  </button>
                </form>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
