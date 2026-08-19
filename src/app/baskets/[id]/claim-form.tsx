"use client";

import { useActionState, useState } from "react";
import { claimPortionsAction, type BasketState } from "../actions";
import { formatGBP } from "@/lib/money";

export function ClaimForm({
  basketId,
  remaining,
  currentPortions,
  pricePerPortion,
}: {
  basketId: string;
  remaining: number;
  currentPortions: number;
  pricePerPortion: number;
}) {
  const action = claimPortionsAction.bind(null, basketId);
  const [state, formAction, pending] = useActionState<BasketState, FormData>(
    action,
    {}
  );

  const max = remaining + currentPortions;
  const isMember = currentPortions > 0;
  const [count, setCount] = useState(isMember ? currentPortions : Math.min(1, max));
  const clamp = (n: number) => Math.max(1, Math.min(max, n));

  const stepBtn =
    "flex h-10 w-10 items-center justify-center text-xl font-bold text-ink disabled:opacity-30";

  return (
    <form action={formAction} className="space-y-3">
      <p className="label">{isMember ? "Adjust your portions" : "Claim portions"}</p>
      <input type="hidden" name="portions" value={count} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-full border border-line-strong">
          <button
            type="button"
            onClick={() => setCount(clamp(count - 1))}
            className={stepBtn}
            disabled={count <= 1}
            aria-label="Fewer portions"
          >
            −
          </button>
          <span className="w-10 text-center text-lg font-bold text-ink">{count}</span>
          <button
            type="button"
            onClick={() => setCount(clamp(count + 1))}
            className={stepBtn}
            disabled={count >= max}
            aria-label="More portions"
          >
            +
          </button>
        </div>
        <button type="submit" className="btn-primary" disabled={pending || max < 1}>
          {pending
            ? "Saving…"
            : isMember
              ? `Update to ${formatGBP(count * pricePerPortion)}`
              : `Join for ${formatGBP(count * pricePerPortion)}`}
        </button>
      </div>
      {state.error && (
        <p className="rounded-xl bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
          {state.error}
        </p>
      )}
    </form>
  );
}
