import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OperatorNav } from "@/components/operator-nav";
import { createProductAction } from "./actions";
import { formatGBP } from "@/lib/money";
import { formatKg } from "@/lib/weight";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  await requireOperator();
  const products = await prisma.product.findMany({
    include: { skus: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="catalogue" />
      <h1 className="font-display text-[38px] leading-tight text-ink">Catalogue</h1>
      <p className="mt-1 text-muted">
        A food and the bulk unit you buy it in. Baskets point at one of these.
      </p>

      <form action={createProductAction} className="card mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">Food</label>
            <input id="name" name="name" className="input" required placeholder="White Yam" />
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <select id="category" name="category" className="input" defaultValue="dry">
              <option value="dry">Dry / shelf-stable</option>
              <option value="fresh">Fresh</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="description">Description</label>
          <input id="description" name="description" className="input" placeholder="Ambient-stable white yam." />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="skuLabel">Bulk unit</label>
            <input id="skuLabel" name="skuLabel" className="input" required placeholder="25 kg crate" />
          </div>
          <div>
            <label className="label" htmlFor="weightKg">Weight (kg)</label>
            <input id="weightKg" name="weightKg" type="number" step="0.1" min="0.1" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="wholesaleCostPounds">Cost (£)</label>
            <input id="wholesaleCostPounds" name="wholesaleCostPounds" type="number" step="0.01" min="0" className="input" required />
          </div>
        </div>
        <button type="submit" className="btn-primary">Add to catalogue</button>
      </form>

      <div className="mt-8 space-y-3">
        {products.map((p) => (
          <div key={p.id} className="card">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-xl text-ink">{p.name}</span>
              <span className="badge bg-brand-50 text-brand-800">{p.category}</span>
            </div>
            {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {p.skus.map((s) => (
                <li key={s.id}>
                  {s.label} · {formatKg(s.weightGrams)} · {formatGBP(s.wholesaleCostPence)} per unit
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
