"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// One form creates a product and its first SKU together. Splitting them would
// mean an operator can save a product they cannot yet sell, which is a state
// worth not having.
const schema = z.object({
  name: z.string().trim().min(1, "Name the food"),
  description: z.string().trim(),
  category: z.enum(["dry", "fresh"]),
  skuLabel: z.string().trim().min(1, "Name the bulk unit, e.g. 25 kg crate"),
  weightKg: z.coerce.number().positive("How many kg is one bulk unit?"),
  wholesaleCostPounds: z.coerce.number().nonnegative("What does one bulk unit cost?"),
});

export async function createProductAction(formData: FormData): Promise<void> {
  await requireOperator();

  const input = schema.parse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    category: formData.get("category"),
    skuLabel: formData.get("skuLabel"),
    weightKg: formData.get("weightKg"),
    wholesaleCostPounds: formData.get("wholesaleCostPounds"),
  });

  await prisma.product.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      skus: {
        create: {
          label: input.skuLabel,
          // Operators think in kg and pounds; storage is grams and pence.
          weightGrams: Math.round(input.weightKg * 1000),
          wholesaleCostPence: Math.round(input.wholesaleCostPounds * 100),
          // Unused this milestone — the purchase trigger was removed in spec
          // revision 4. Set to 1 so the NOT NULL column has a harmless value.
          purchaseThresholdGrams: 1,
        },
      },
    },
  });

  revalidatePath("/operator/catalogue");
  revalidatePath("/operator/baskets");
}
