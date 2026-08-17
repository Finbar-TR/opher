"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "./actions";

type Props = {
  mode: "sign-in" | "sign-up";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
};

export function AuthForm({ mode, action, next }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignUp = mode === "sign-up";

  return (
    <div className="mx-auto max-w-sm">
      <div className="card">
        <h1 className="text-2xl font-bold text-ink">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isSignUp
            ? "Start a basket or join one to bulk-buy together."
            : "Sign in to manage your baskets and orders."}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          {isSignUp && (
            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" className="input" autoComplete="name" required />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
            />
            {!isSignUp && (
              <p className="mt-1.5 text-right">
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Forgot password?
                </Link>
              </p>
            )}
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-muted">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Opher?{" "}
            <Link href="/sign-up" className="font-semibold text-brand-700 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
