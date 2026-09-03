"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import { poundsToPence } from "@/lib/money";
import { kgToGrams } from "@/lib/weight";
import {
  MAX_BULK_COST_POUNDS,
  MAX_BULK_WEIGHT_KG,
  type ProductFormState,
  type ProductFormValues,
} from "./product-input";

// One form creates a product and its first SKU together. Splitting them would
// mean an operator can save a product they cannot yet sell, which is a state
// worth not having.
const schema = z.object({
  name: z.string().trim().min(1, "Name the food"),
  description: z.string().trim(),
  category: z.enum(PRODUCT_CATEGORIES),
  skuLabel: z.string().trim().min(1, "Name the bulk unit, e.g. 25 kg crate"),
  weightKg: z.coerce
    .number()
    .positive("How many kg is one bulk unit?")
    .max(MAX_BULK_WEIGHT_KG, `A bulk unit over ${MAX_BULK_WEIGHT_KG} kg isn't a bulk unit — check the weight.`),
  wholesaleCostPounds: z.coerce
    .number()
    .nonnegative("What does one bulk unit cost?")
    .max(MAX_BULK_COST_POUNDS, "That cost looks like a typo — check the figure."),
});

// Returns its errors rather than throwing them. A mistyped weight is a routine
// operator mistake, and the error boundary cannot show the operator what it was
// in production — so the message comes back through `useActionState`, next to
// the form, with their typed values alongside it.
export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  await requireOperator();

  const values: ProductFormValues = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    category: String(formData.get("category") ?? ""),
    skuLabel: String(formData.get("skuLabel") ?? ""),
    weightKg: String(formData.get("weightKg") ?? ""),
    wholesaleCostPounds: String(formData.get("wholesaleCostPounds") ?? ""),
  };

  const result = schema.safeParse(values);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      error:
        firstIssue?.message ||
        "That form isn't quite right — check the values and try again.",
      values,
    };
  }

  const input = result.data;

  await prisma.product.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      skus: {
        create: {
          label: input.skuLabel,
          // Operators think in kg and pounds; storage is grams and pence.
          weightGrams: kgToGrams(input.weightKg),
          wholesaleCostPence: poundsToPence(input.wholesaleCostPounds),
          // Unused this milestone — the purchase trigger was removed in spec
          // revision 4. Set to 1 so the NOT NULL column has a harmless value.
          purchaseThresholdGrams: 1,
        },
      },
    },
  });

  revalidatePath("/operator/catalogue");
  revalidatePath("/operator/baskets");

  return { error: null, values: null };
}
