"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, hashPassword, verifyPassword } from "@/lib/auth";

export type AccountState = { error?: string; ok?: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  addrLine1: z.string().trim().max(120).optional().default(""),
  addrLine2: z.string().trim().max(120).optional().default(""),
  addrCity: z.string().trim().max(80).optional().default(""),
  postcode: z.string().trim().max(12).optional().default(""),
  phone: z.string().trim().max(30).optional().default(""),
});

export async function updateProfileAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    addrLine1: formData.get("addrLine1") ?? "",
    addrLine2: formData.get("addrLine2") ?? "",
    addrCity: formData.get("addrCity") ?? "",
    postcode: formData.get("postcode") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const d = parsed.data;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: d.name,
      addrLine1: d.addrLine1 || null,
      addrLine2: d.addrLine2 || null,
      addrCity: d.addrCity || null,
      postcode: d.postcode ? d.postcode.toUpperCase() : null,
      phone: d.phone || null,
    },
  });
  revalidatePath("/account");
  return { ok: "Profile saved." };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function changePasswordAction(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const sessionUser = await requireUser();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return { error: "Your current password is incorrect" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });
  return { ok: "Password updated." };
}
