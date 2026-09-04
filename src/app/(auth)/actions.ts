"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createToken, consumeToken } from "@/lib/tokens";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/notifications";

export type AuthState = { error?: string; ok?: string };

// Only allow same-origin relative redirects (block open-redirect via `next`).
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signUpAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const { name, email, password } = parsed.data;

  const limit = rateLimit(`signup:${email}`, 5, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Too many attempts. Please try again later." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists" };
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password) },
  });

  // Fire off a verification email (non-blocking to the sign-up flow).
  const token = await createToken(user.id, "email_verify", 60 * 24);
  await sendVerificationEmail(user.email, user.name, token);

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function signInAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const { email, password } = parsed.data;

  const limit = rateLimit(`signin:${email}`, 10, 15 * 60 * 1000);
  if (!limit.ok) return { error: "Too many attempts. Please try again later." };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Incorrect email or password" };
  }

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

// Request a password-reset link. Always reports success to avoid revealing which
// emails have accounts.
export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }
  const { email } = parsed.data;

  const limit = rateLimit(`reset:${email}`, 5, 60 * 60 * 1000);
  if (limit.ok) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await createToken(user.id, "password_reset", 60);
      await sendPasswordResetEmail(user.email, user.name, token);
    }
  }
  return { ok: "If that email has an account, we've sent a reset link." };
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const userId = await consumeToken(parsed.data.token, "password_reset");
  if (!userId) {
    return { error: "This reset link is invalid or has expired." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  });
  redirect("/sign-in");
}

// Resend a verification email to the currently signed-in user.
export async function resendVerificationAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const full = await prisma.user.findUnique({ where: { id: user.id } });
  if (!full || full.emailVerified) return;

  const token = await createToken(full.id, "email_verify", 60 * 24);
  await sendVerificationEmail(full.email, full.name, token);
}
