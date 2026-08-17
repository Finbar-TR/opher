"use client";

import { useActionState } from "react";
import { claimPortionsAction, type BasketState } from "../actions";

export function ClaimForm({
  basketId,
  remaining,
  currentPortions,
}: {
  basketId: string;
  remaining: number;
  currentPortions: number;
}) {
  const action = claimPortionsAction.bind(null, basketId);
  const [state, formAction, pending] = useActionState<BasketState, FormData>(
    action,
    {}
  );

  const max = remaining + currentPortions;
  const isMember = currentPortions > 0;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label" htmlFor="portions">
          {isMember ? "Adjust your portions" : "Claim portions"}
        </label>
        <input
          id="portions"
          name="portions"
          type="number"
          min={1}
          max={max}
          defaultValue={isMember ? currentPortions : Math.min(1, max)}
          className="input w-32"
          required
        />
      </div>
      <button type="submit" className="btn-primary" disabled={pending || max < 1}>
        {pending ? "Saving…" : isMember ? "Update" : "Join basket"}
      </button>
      {state.error && (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
