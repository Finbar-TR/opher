"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction, type AuthState } from "../actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    requestPasswordResetAction,
    {}
  );

  return (
    <div className="mx-auto max-w-sm">
      <div className="card">
        <h1 className="font-display text-[32px] leading-tight text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your email and we&apos;ll send a reset link.
        </p>
        <form action={action} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" className="input" required />
          </div>
          {state.error && (
            <p className="rounded-lg bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
              {state.error}
            </p>
          )}
          {state.ok && (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              {state.ok}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </div>
      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/sign-in" className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
