import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OperatorNav } from "@/components/operator-nav";
import { ProductForm } from "./product-form";
import { formatGBP } from "@/lib/money";
import { formatKg } from "@/lib/weight";
import { PRODUCT_CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Keyed by PRODUCT_CATEGORIES so a new category shows up here rather than
// silently falling back to its raw slug.
const CATEGORY_LABELS: Record<(typeof PRODUCT_CATEGORIES)[number], string> = {
  dry: "Dry / shelf-stable",
  fresh: "Fresh",
};

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

      {/* Only the form is a Client Component — the Prisma query above stays on
          the server. It has to be one so a rejected submit can render its own
          message beside it. */}
      <ProductForm categoryLabels={CATEGORY_LABELS} />

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
