"use client";

import { useActionState } from "react";
import { createZoneAction, type ZoneState } from "../actions";

export function ZoneForm() {
  const [state, action, pending] = useActionState<ZoneState, FormData>(
    createZoneAction,
    {}
  );

  return (
    <form action={action} className="card space-y-4">
      <h2 className="text-lg font-semibold text-ink">Add a delivery zone</h2>
      <div>
        <label className="label" htmlFor="name">
          Zone name
        </label>
        <input id="name" name="name" className="input" placeholder="e.g. South Manchester" required />
      </div>
      <div>
        <label className="label" htmlFor="outwardCodes">
          Covered outward codes (comma-separated)
        </label>
        <input
          id="outwardCodes"
          name="outwardCodes"
          className="input"
          placeholder="M14, M15, M16"
          required
        />
        <p className="mt-1 text-xs text-muted">
          The first half of a postcode (e.g. &quot;M14&quot; from &quot;M14 5AB&quot;).
          Baskets can only be created by people in an active zone.
        </p>
      </div>
      {state.error && (
        <p className="rounded-lg bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Add zone"}
      </button>
    </form>
  );
}
