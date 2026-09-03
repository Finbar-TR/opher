"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BASKET_STATUSES } from "@/lib/constants";
import { parseTiers } from "@/lib/basket-tiers";

const basketSchema = z.object({
  cityId: z.string().trim().min(1, "Pick a city"),
  skuId: z.string().trim().min(1, "Pick a food"),
  label: z.string().trim().min(1, "Give the basket a name"),
});

export async function createBasketAction(formData: FormData): Promise<void> {
  const operator = await requireOperator();

  const basketResult = basketSchema.safeParse({
    cityId: formData.get("cityId"),
    skuId: formData.get("skuId"),
    label: formData.get("label"),
  });

  if (!basketResult.success) {
    const firstIssue = basketResult.error.issues[0];
    throw new Error(firstIssue?.message || "That form isn't quite right — check the values and try again.");
  }

  const basket = basketResult.data;

  // Tier fields arrive as parallel arrays: tierLabel[], tierWeightKg[], tierPricePounds[].
  const labels = formData.getAll("tierLabel").map(String);
  const weights = formData.getAll("tierWeightKg").map(String);
  const prices = formData.getAll("tierPricePounds").map(String);

  // The zipping, the blank-row rule, the 2–4 bound and the unit conversion all
  // live in `parseTiers` so they can be tested without faking `requireOperator`
  // or a database. None of it had a test before.
  const parsed = parseTiers(labels, weights, prices);
  if (!parsed.ok) throw new Error(parsed.message);
  const tiers = parsed.tiers;

  // One live basket per bulk unit per city. The schema cannot express a partial
  // unique index, so it is enforced here — and archiving one deliberately frees
  // the pair for a new basket.
  const clash = await prisma.basket.findFirst({
    where: { cityId: basket.cityId, skuId: basket.skuId, status: { not: "archived" } },
  });
  if (clash) {
    throw new Error("That city already has a live basket for this food.");
  }

  await prisma.basket.create({
    data: {
      cityId: basket.cityId,
      skuId: basket.skuId,
      label: basket.label,
      createdById: operator.id,
      tiers: {
        create: tiers.map((t, i) => ({
          label: t.label,
          weightGrams: t.weightGrams,
          pricePence: t.pricePence,
          displayOrder: i + 1,
        })),
      },
    },
  });

  revalidatePath("/operator/baskets");
  revalidatePath("/baskets");
}

export async function setBasketStatusAction(formData: FormData): Promise<void> {
  await requireOperator();
  const id = String(formData.get("basketId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!id) throw new Error("Missing basket.");
  if (!(BASKET_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Unknown status.");
  }

  // Pausing and archiving both stop new joins. Neither touches existing orders:
  // those are already committed, and their customers are owed the delivery they
  // joined for.
  await prisma.basket.update({ where: { id }, data: { status } });

  revalidatePath("/operator/baskets");
  revalidatePath("/baskets");
  revalidatePath(`/baskets/${id}`);
}
