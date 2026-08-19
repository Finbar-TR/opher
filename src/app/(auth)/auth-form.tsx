"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "./actions";
import { Logo } from "@/components/logo";
import { PhotoSlot } from "@/components/ui";

type Props = {
  mode: "sign-in" | "sign-up";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
};

export function AuthForm({ mode, action, next }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignUp = mode === "sign-up";

  return (
    <div className="mx-auto max-w-[490px]">
      <div className="overflow-hidden rounded-[22px] border border-line bg-surface">
        <PhotoSlot
          caption="Hands passing a bowl of lentils"
          className="h-[130px] w-full"
        />
        <div className="p-7">
          <Logo ring={20} textClass="text-[24px]" />
          <h1 className="mt-4 font-display text-[40px] leading-tight text-ink">
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
                    className="text-xs font-bold text-tomato hover:underline"
                  >
                    Forgot password?
                  </Link>
                </p>
              )}
            </div>

            {state.error && (
              <p className="rounded-xl bg-saffron px-3 py-2 text-sm font-medium text-tomato-press">
                {state.error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={pending}>
              {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      </div>

      <p className="mt-4 text-center text-sm text-muted">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="font-extrabold text-tomato hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Opher?{" "}
            <Link href="/sign-up" className="font-extrabold text-tomato hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
