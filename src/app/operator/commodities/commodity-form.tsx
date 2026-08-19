"use client";

import { useActionState } from "react";
import type { CommodityState } from "../actions";

export type CommodityInitial = {
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  baseUnit: string;
  bulkUnitLabel: string;
  portionsPerBulkUnit: number;
  pricePerPortionPounds: number;
  shopPricePerPortionPounds: number | "";
  deliveryFeePounds: number;
  deliveryLeadDays: number;
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          <input
            id="category"
            name="category"
            className="input"
            placeholder="e.g. Grains"
            defaultValue={initial?.category ?? "Food"}
            required
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
        <div>
          <label className="label" htmlFor="shopPricePerPortionPounds">
            Typical shop price per portion (£, optional)
          </label>
          <input
            id="shopPricePerPortionPounds"
            name="shopPricePerPortionPounds"
            type="number"
            min={0.01}
            step="0.01"
            className="input"
            placeholder="drives the 'you save £X' badge"
            defaultValue={initial?.shopPricePerPortionPounds}
          />
        </div>
        <div>
          <label className="label" htmlFor="deliveryFeePounds">
            Delivery fee per person (£)
          </label>
          <input
            id="deliveryFeePounds"
            name="deliveryFeePounds"
            type="number"
            min={0}
            step="0.01"
            className="input"
            defaultValue={initial?.deliveryFeePounds ?? 0}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="deliveryLeadDays">
            Delivery lead time (days)
          </label>
          <input
            id="deliveryLeadDays"
            name="deliveryLeadDays"
            type="number"
            min={1}
            max={60}
            step={1}
            className="input"
            defaultValue={initial?.deliveryLeadDays ?? 7}
            required
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
