"use client";

import { useActionState, useState } from "react";
import { createBasketAction } from "./actions";
import {
  EMPTY_BASKET_FORM,
  TIER_ROWS,
  type BasketFormValues,
} from "./basket-input";
import {
  MAX_TIER_PRICE_POUNDS,
  MAX_TIER_WEIGHT_KG,
} from "@/lib/basket-tiers";

type Option = { id: string; label: string };

// Tier rows are rendered up front; rows the operator left entirely blank are
// dropped server-side. That keeps this a plain <form action={...}> with no
// client state beyond the row count, so it still submits before hydration.
export function BasketForm({ cities, skus }: { cities: Option[]; skus: Option[] }) {
  const [state, formAction, pending] = useActionState(
    createBasketAction,
    EMPTY_BASKET_FORM
  );
  const [extraRows, setExtraRows] = useState(2);

  const v: BasketFormValues | null = state.values;
  // A rejected submit comes back with as many rows as were on screen when it
  // was sent — never show fewer than that, or the operator's fourth size
  // vanishes along with the message telling them to fix it.
  const rows = Math.min(
    TIER_ROWS,
    Math.max(extraRows, v?.tierLabels.length ?? 0)
  );

  return (
    <form action={formAction} className="card space-y-4">
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
          <label className="label" htmlFor="cityId">City</label>
          <select id="cityId" name="cityId" className="input" required defaultValue={v?.cityId ?? ""}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="skuId">Food</label>
          <select id="skuId" name="skuId" className="input" required defaultValue={v?.skuId ?? ""}>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="label">Basket name</label>
        <input id="label" name="label" className="input" required placeholder="White Yam — Sheffield" defaultValue={v?.label ?? ""} />
      </div>

      <fieldset>
        <legend className="label">Sizes (2–4)</legend>
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <input
                name="tierLabel"
                className="input"
                placeholder="Medium (5 kg)"
                required={i < 2}
                defaultValue={v?.tierLabels[i] ?? ""}
              />
              <input
                name="tierWeightKg"
                type="number"
                step="0.1"
                min="0.1"
                max={MAX_TIER_WEIGHT_KG}
                className="input"
                placeholder="kg"
                required={i < 2}
                defaultValue={v?.tierWeights[i] ?? ""}
              />
              <input
                name="tierPricePounds"
                type="number"
                step="0.01"
                min="0.01"
                max={MAX_TIER_PRICE_POUNDS}
                className="input"
                placeholder="£"
                required={i < 2}
                defaultValue={v?.tierPrices[i] ?? ""}
              />
            </div>
          ))}
        </div>
        {rows < TIER_ROWS && (
          <button type="button" className="btn-secondary mt-3" onClick={() => setExtraRows(rows + 1)}>
            Add another size
          </button>
        )}
      </fieldset>

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create basket"}
      </button>
    </form>
  );
}
