"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { generateInviteCode } from "@/lib/ids";
import { tryMergeCommodity } from "@/lib/merge-orders";
import { hasDeliveryAddress } from "@/lib/address";
import { daysFromNow } from "@/lib/dates";
import { outwardCode, zoneCovers } from "@/lib/postcode";

const NEEDS_ADDRESS =
  "Add your delivery address and phone in your account before claiming portions.";

export type BasketState = { error?: string };

const createSchema = z.object({
  commodityId: z.string().min(1),
  title: z.string().trim().min(1, "Give your basket a name").max(80),
  targetPortions: z.coerce.number().int().min(1, "At least 1 portion"),
  yourPortions: z.coerce.number().int().min(1, "Claim at least 1 portion"),
  closeDays: z.coerce.number().int().min(1).max(90).optional().default(14),
  visibility: z.enum(["private", "public"]).optional().default("private"),
});

export async function createBasketAction(
  _prev: BasketState,
  formData: FormData
): Promise<BasketState> {
  const user = await requireUser();
  const parsed = createSchema.safeParse({
    commodityId: formData.get("commodityId"),
    title: formData.get("title"),
    targetPortions: formData.get("targetPortions"),
    yourPortions: formData.get("yourPortions"),
    closeDays: formData.get("closeDays") ?? undefined,
    visibility: formData.get("visibility") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { commodityId, title, targetPortions, yourPortions, closeDays, visibility } =
    parsed.data;
  // Unchecked checkbox is absent; default is "allow merging".
  const allowMerge = formData.get("allowMerge") !== null;

  const fullUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!hasDeliveryAddress(fullUser)) return { error: NEEDS_ADDRESS };

  const commodity = await prisma.commodity.findUnique({
    where: { id: commodityId },
  });
  if (!commodity || !commodity.active) {
    return { error: "That commodity is unavailable" };
  }
  // A basket is capped at one whole bulk unit; the merge engine combines baskets.
  if (targetPortions > commodity.portionsPerBulkUnit) {
    return {
      error: `A basket can target at most ${commodity.portionsPerBulkUnit} portions (one ${commodity.bulkUnitLabel}).`,
    };
  }
  if (yourPortions > targetPortions) {
    return { error: "You can't claim more than the basket's target" };
  }

  // Zone gating — only active once the operator has defined live delivery zones.
  const oc = outwardCode(fullUser.postcode);
  const zones = await prisma.deliveryZone.findMany({ where: { active: true } });
  if (zones.length > 0 && !zones.some((z) => zoneCovers(z.outwardCodes, oc))) {
    const already = await prisma.waitlist.findFirst({
      where: { email: fullUser.email, postcode: fullUser.postcode ?? "" },
    });
    if (!already) {
      await prisma.waitlist.create({
        data: { email: fullUser.email, postcode: fullUser.postcode ?? "" },
      });
    }
    return {
      error: `We're not delivering to ${oc ?? "your area"} yet — you're on the waitlist and we'll let you know when we launch there.`,
    };
  }

  const basket = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: user.id,
      title,
      targetPortions,
      visibility,
      allowMerge,
      outwardCode: oc,
      inviteCode: generateInviteCode(),
      expiresAt: daysFromNow(closeDays),
      claims: { create: { userId: user.id, portions: yourPortions } },
    },
  });

  redirect(`/baskets/${basket.id}`);
}

const claimSchema = z.object({
  portions: z.coerce.number().int().min(1, "Claim at least 1 portion"),
});

// Set the current user's claim within a basket (join or adjust).
export async function claimPortionsAction(
  basketId: string,
  _prev: BasketState,
  formData: FormData
): Promise<BasketState> {
  const user = await requireUser();
  const parsed = claimSchema.safeParse({ portions: formData.get("portions") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid amount" };
  }
  const { portions } = parsed.data;

  const fullUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!hasDeliveryAddress(fullUser)) return { error: NEEDS_ADDRESS };

  const basket = await prisma.basket.findUnique({
    where: { id: basketId },
    include: { claims: true },
  });
  if (!basket) return { error: "Basket not found" };
  if (basket.status !== "open") {
    return { error: "This basket is no longer open for changes" };
  }

  const othersTotal = basket.claims
    .filter((c) => c.userId !== user.id)
    .reduce((sum, c) => sum + c.portions, 0);

  if (othersTotal + portions > basket.targetPortions) {
    const remaining = basket.targetPortions - othersTotal;
    return {
      error: `Only ${remaining} portion(s) remaining in this basket`,
    };
  }

  await prisma.portionClaim.upsert({
    where: { basketId_userId: { basketId, userId: user.id } },
    update: { portions },
    create: { basketId, userId: user.id, portions },
  });

  revalidatePath(`/baskets/${basketId}`);
  return {};
}

// Organiser commits the basket to buy. Locks it, then runs the merge engine
// across all committed baskets for the commodity to form whole-unit orders.
export async function commitBasketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const basketId = String(formData.get("basketId"));

  const basket = await prisma.basket.findUnique({
    where: { id: basketId },
    include: { claims: true },
  });
  if (!basket || basket.organiserId !== user.id || basket.status !== "open") {
    return;
  }
  const filled = basket.claims.reduce((s, c) => s + c.portions, 0);
  if (filled < 1) return;

  await prisma.basket.update({
    where: { id: basketId },
    data: { status: "committed" },
  });
  await tryMergeCommodity(basket.commodityId);

  revalidatePath(`/baskets/${basketId}`);
  revalidatePath("/operator/demand");
  redirect(`/baskets/${basketId}`);
}

// Leave a basket (members only; organiser can't abandon their own basket).
export async function leaveBasketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const basketId = String(formData.get("basketId"));
  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket || basket.status !== "open") return;
  if (basket.organiserId === user.id) return;

  await prisma.portionClaim.deleteMany({
    where: { basketId, userId: user.id },
  });
  revalidatePath(`/baskets/${basketId}`);
}

// Organiser removes another member's claim from an open basket.
export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const basketId = String(formData.get("basketId"));
  const memberId = String(formData.get("userId"));
  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket || basket.status !== "open" || basket.organiserId !== user.id) return;
  if (memberId === basket.organiserId) return; // organiser stays

  await prisma.portionClaim.deleteMany({
    where: { basketId, userId: memberId },
  });
  revalidatePath(`/baskets/${basketId}`);
}

// Organiser un-commits a committed basket (only while it hasn't merged into an
// order), returning it to "open" so portions can change again.
export async function uncommitBasketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const basketId = String(formData.get("basketId"));
  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket || basket.organiserId !== user.id) return;
  if (basket.status !== "committed" || basket.orderId) return;

  await prisma.basket.update({
    where: { id: basketId },
    data: { status: "open" },
  });
  revalidatePath(`/baskets/${basketId}`);
}

// Organiser cancels a basket that hasn't yet merged into an order.
export async function cancelBasketAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const basketId = String(formData.get("basketId"));
  const basket = await prisma.basket.findUnique({ where: { id: basketId } });
  if (!basket || basket.organiserId !== user.id || basket.orderId) return;
  if (basket.status !== "open" && basket.status !== "committed") return;

  await prisma.basket.update({
    where: { id: basketId },
    data: { status: "cancelled" },
  });
  revalidatePath(`/baskets/${basketId}`);
  revalidatePath("/baskets");
}
