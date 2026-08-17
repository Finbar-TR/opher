"use client";

import { useActionState, useState } from "react";
import { createBasketAction, type BasketState } from "../actions";
import { formatGBP } from "@/lib/money";

type Props = {
  commodityId: string;
  commodityName: string;
  bulkUnitLabel: string;
  portionsPerBulkUnit: number;
  pricePerPortion: number;
};

export function BasketForm({
  commodityId,
  commodityName,
  bulkUnitLabel,
  portionsPerBulkUnit,
  pricePerPortion,
}: Props) {
  const [state, formAction, pending] = useActionState<BasketState, FormData>(
    createBasketAction,
    {}
  );
  const [yourPortions, setYourPortions] = useState(1);

  return (
    <form action={formAction} className="card space-y-5">
      <input type="hidden" name="commodityId" value={commodityId} />

      <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
        <strong>{commodityName}</strong> — one {bulkUnitLabel} splits into{" "}
        {portionsPerBulkUnit} portions at {formatGBP(pricePerPortion)} each.
      </div>

      <div>
        <label className="label" htmlFor="title">
          Basket name
        </label>
        <input
          id="title"
          name="title"
          className="input"
          placeholder="e.g. Elm Street neighbours"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="targetPortions">
            Portions your group wants (max {portionsPerBulkUnit})
          </label>
          <input
            id="targetPortions"
            name="targetPortions"
            type="number"
            min={1}
            max={portionsPerBulkUnit}
            defaultValue={portionsPerBulkUnit}
            className="input"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="yourPortions">
            Portions you&apos;ll take
          </label>
          <input
            id="yourPortions"
            name="yourPortions"
            type="number"
            min={1}
            max={portionsPerBulkUnit}
            value={yourPortions}
            onChange={(e) => setYourPortions(Number(e.target.value))}
            className="input"
            required
          />
          <p className="mt-1 text-xs text-muted">
            Your share: {formatGBP(pricePerPortion * Math.max(0, yourPortions))}
          </p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="closeDays">
          Close basket after (days)
        </label>
        <input
          id="closeDays"
          name="closeDays"
          type="number"
          min={1}
          max={90}
          defaultValue={14}
          className="input sm:w-40"
          required
        />
        <p className="mt-1 text-xs text-muted">
          If it hasn&apos;t merged into a whole unit by then, it closes automatically and
          no one is charged.
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Create basket"}
      </button>
    </form>
  );
}
