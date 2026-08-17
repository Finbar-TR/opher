"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthState } from "../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    resetPasswordAction,
    {}
  );

  return (
    <div className="mx-auto max-w-sm">
      <div className="card">
        <h1 className="text-2xl font-bold text-ink">Choose a new password</h1>
        <form action={action} className="mt-6 space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label className="label" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
            />
          </div>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
