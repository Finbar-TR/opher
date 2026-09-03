"use client";

import { useActionState } from "react";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import { createProductAction } from "./actions";
import {
  EMPTY_PRODUCT_FORM,
  MAX_BULK_COST_POUNDS,
  MAX_BULK_WEIGHT_KG,
} from "./product-input";

// Only the form is a Client Component. The page around it stays on the server
// so its Prisma query does.
export function ProductForm({
  categoryLabels,
}: {
  categoryLabels: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(
    createProductAction,
    EMPTY_PRODUCT_FORM
  );

  // React resets an uncontrolled form once the action settles, so every field
  // falls back to its `defaultValue`. Seeding those from the rejected submit is
  // what keeps the operator's typing on screen next to the message.
  const v = state.values;

  return (
    <form action={formAction} className="card mt-6 space-y-4">
      {state.error && (
        <p
          aria-live="polite"
          className="rounded-lg border border-line-strong bg-saffron px-3 py-2 text-[15px] font-medium text-saffron-ink"
        >
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Food</label>
          <input id="name" name="name" className="input" required placeholder="White Yam" defaultValue={v?.name ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" name="category" className="input" defaultValue={v?.category || "dry"}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabels[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="description">Description</label>
        <input id="description" name="description" className="input" placeholder="Ambient-stable white yam." defaultValue={v?.description ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="skuLabel">Bulk unit</label>
          <input id="skuLabel" name="skuLabel" className="input" required placeholder="25 kg crate" defaultValue={v?.skuLabel ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="weightKg">Weight (kg)</label>
          <input id="weightKg" name="weightKg" type="number" step="0.1" min="0.1" max={MAX_BULK_WEIGHT_KG} className="input" required defaultValue={v?.weightKg ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="wholesaleCostPounds">Cost (£)</label>
          <input id="wholesaleCostPounds" name="wholesaleCostPounds" type="number" step="0.01" min="0" max={MAX_BULK_COST_POUNDS} className="input" required defaultValue={v?.wholesaleCostPounds ?? ""} />
        </div>
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Add to catalogue"}
      </button>
    </form>
  );
}
