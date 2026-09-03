"use client";

import { useState } from "react";
import { createBasketAction } from "./actions";

type Option = { id: string; label: string };

// Four tier rows are rendered up front; empty ones are dropped server-side.
// That keeps the form a plain <form action={...}> with no client state beyond
// the row count, so it works before hydration.
const ROWS = 4;

export function BasketForm({ cities, skus }: { cities: Option[]; skus: Option[] }) {
  const [rows, setRows] = useState(2);

  return (
    <form action={createBasketAction} className="card space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cityId">City</label>
          <select id="cityId" name="cityId" className="input" required>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="skuId">Food</label>
          <select id="skuId" name="skuId" className="input" required>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="label">Basket name</label>
        <input id="label" name="label" className="input" required placeholder="White Yam — Sheffield" />
      </div>

      <fieldset>
        <legend className="label">Sizes (2–4)</legend>
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <input name="tierLabel" className="input" placeholder="Medium (5 kg)" required={i < 2} />
              <input name="tierWeightKg" type="number" step="0.1" min="0.1" className="input" placeholder="kg" required={i < 2} />
              <input name="tierPricePounds" type="number" step="0.01" min="0.01" className="input" placeholder="£" required={i < 2} />
            </div>
          ))}
        </div>
        {rows < ROWS && (
          <button type="button" className="btn-secondary mt-3" onClick={() => setRows(rows + 1)}>
            Add another size
          </button>
        )}
      </fieldset>

      <button type="submit" className="btn-primary">Create basket</button>
    </form>
  );
}
