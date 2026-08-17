"use client";

import { useActionState } from "react";
import type { CommodityState } from "../actions";

export type CommodityInitial = {
  name: string;
  description: string;
  imageUrl: string;
  baseUnit: string;
  bulkUnitLabel: string;
  portionsPerBulkUnit: number;
  pricePerPortionPounds: number;
};

export function CommodityForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: CommodityState, formData: FormData) => Promise<CommodityState>;
  initial?: CommodityInitial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="card space-y-4">
      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" className="input" defaultValue={initial?.name} required />
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          className="input"
          rows={3}
          defaultValue={initial?.description}
        />
      </div>

      <div>
        <label className="label" htmlFor="imageUrl">
          Image URL (optional)
        </label>
        <input
          id="imageUrl"
          name="imageUrl"
          className="input"
          placeholder="https://…"
          defaultValue={initial?.imageUrl}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="baseUnit">
            Base unit (e.g. kg)
          </label>
          <input
            id="baseUnit"
            name="baseUnit"
            className="input"
            defaultValue={initial?.baseUnit}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="bulkUnitLabel">
            Bulk unit (e.g. 25kg sack)
          </label>
          <input
            id="bulkUnitLabel"
            name="bulkUnitLabel"
            className="input"
            defaultValue={initial?.bulkUnitLabel}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="portionsPerBulkUnit">
            Portions per bulk unit
          </label>
          <input
            id="portionsPerBulkUnit"
            name="portionsPerBulkUnit"
            type="number"
            min={1}
            step={1}
            className="input"
            defaultValue={initial?.portionsPerBulkUnit}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pricePerPortionPounds">
            Price per portion (£)
          </label>
          <input
            id="pricePerPortionPounds"
            name="pricePerPortionPounds"
            type="number"
            min={0.01}
            step="0.01"
            className="input"
            defaultValue={initial?.pricePerPortionPounds}
            required
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
