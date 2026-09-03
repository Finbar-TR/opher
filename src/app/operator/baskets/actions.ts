"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BASKET_STATUSES } from "@/lib/constants";
import { parseTiers } from "@/lib/basket-tiers";
import type { BasketFormState, BasketFormValues } from "./basket-input";

const basketSchema = z.object({
  cityId: z.string().trim().min(1, "Pick a city"),
  skuId: z.string().trim().min(1, "Pick a food"),
  label: z.string().trim().min(1, "Give the basket a name"),
});

// Returns its errors rather than throwing them. Every failure below is a
// routine operator mistake — a half-filled size row, a city that already has
// this food — and the error boundary cannot show what it was in production, so
// the message comes back through `useActionState` next to the form, with the
// operator's typed values so a rejected submit does not wipe fifteen fields.
export async function createBasketAction(
  _prev: BasketFormState,
  formData: FormData
): Promise<BasketFormState> {
  const operator = await requireOperator();

  // Tier fields arrive as parallel arrays: tierLabel[], tierWeightKg[], tierPricePounds[].
  const labels = formData.getAll("tierLabel").map(String);
  const weights = formData.getAll("tierWeightKg").map(String);
  const prices = formData.getAll("tierPricePounds").map(String);

  const values: BasketFormValues = {
    cityId: String(formData.get("cityId") ?? ""),
    skuId: String(formData.get("skuId") ?? ""),
    label: String(formData.get("label") ?? ""),
    tierLabels: labels,
    tierWeights: weights,
    tierPrices: prices,
  };

  const basketResult = basketSchema.safeParse(values);

  if (!basketResult.success) {
    const firstIssue = basketResult.error.issues[0];
    return {
      error:
        firstIssue?.message ||
        "That form isn't quite right — check the values and try again.",
      values,
    };
  }

  const basket = basketResult.data;

  // The zipping, the blank-row rule, the 2–4 bound and the unit conversion all
  // live in `parseTiers` so they can be tested without faking `requireOperator`
  // or a database. None of it had a test before.
  const parsed = parseTiers(labels, weights, prices);
  if (!parsed.ok) return { error: parsed.message, values };
  const tiers = parsed.tiers;

  // One live basket per bulk unit per city. The schema cannot express a partial
  // unique index, so it is enforced here — and archiving one deliberately frees
  // the pair for a new basket.
  const clash = await prisma.basket.findFirst({
    where: { cityId: basket.cityId, skuId: basket.skuId, status: { not: "archived" } },
  });
  if (clash) {
    return {
      error: "That city already has a live basket for this food.",
      values,
    };
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

  return { error: null, values: null };
}

// This one keeps THROWING. Pause, Resume and Archive post fixed hidden values
// the operator cannot mistype, so a failure here means the basket is gone or
// the request was tampered with — genuinely unexpected, and the error boundary
// is the right place for it. Logged first so the digest shown on screen can be
// matched to a message in the server log.
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
  // joined for. Restoring an archived basket to `open` runs through here too —
  // and archiving deliberately freed its (cityId, skuId) pair, so a new basket
  // may have already taken it. Re-run the same clash check `createBasketAction`
  // uses before writing, or Restore can put two live baskets on one pair.
  try {
    const basket = await prisma.basket.findUniqueOrThrow({ where: { id } });

    if (status === "open" && basket.status === "archived") {
      const clash = await prisma.basket.findFirst({
        where: {
          cityId: basket.cityId,
          skuId: basket.skuId,
          status: { not: "archived" },
          id: { not: id },
        },
      });
      if (clash) {
        throw new Error(
          `Can't restore — "${clash.label}" already holds this city and food. Archive it first.`
        );
      }
    }

    await prisma.basket.update({ where: { id }, data: { status } });
  } catch (err) {
    console.error("[operator] setBasketStatusAction failed", { id, status }, err);
    throw err;
  }

  revalidatePath("/operator/baskets");
  revalidatePath("/baskets");
  revalidatePath(`/baskets/${id}`);
}
