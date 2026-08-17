import "server-only";
import { randomBytes, createHash } from "crypto";
import { prisma } from "./prisma";

// One-time tokens for password reset and email verification. Only the SHA-256
// hash is stored; the raw token lives only in the emailed link.

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createToken(
  userId: string,
  type: "password_reset" | "email_verify",
  ttlMinutes: number
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      userId,
      type,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return raw;
}

// Validate and single-use a token. Returns the userId, or null if invalid,
// expired, already used, or the wrong type.
export async function consumeToken(
  raw: string,
  type: "password_reset" | "email_verify"
): Promise<string | null> {
  const rec = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!rec || rec.type !== type || rec.usedAt || rec.expiresAt < new Date()) {
    return null;
  }
  await prisma.verificationToken.update({
    where: { id: rec.id },
    data: { usedAt: new Date() },
  });
  return rec.userId;
}
