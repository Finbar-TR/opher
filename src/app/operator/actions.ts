"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOperator } from "@/lib/auth";
import { poundsToPence } from "@/lib/money";
import { tryMergeCommodity } from "@/lib/merge-orders";
import { cancelOrder } from "@/lib/orders";
import { sendOrderStatusEmails } from "@/lib/notifications";
import { FULFILMENT_STEPS, type OrderStatus } from "@/lib/constants";

export type CommodityState = { error?: string };

const commoditySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional().default(""),
  imageUrl: z
    .union([z.string().trim().url("Enter a valid image URL"), z.literal("")])
    .optional(),
  baseUnit: z.string().trim().min(1, "Base unit is required").max(20),
  bulkUnitLabel: z.string().trim().min(1, "Bulk unit label is required").max(40),
  portionsPerBulkUnit: z.coerce
    .number()
    .int("Must be a whole number")
    .min(1, "At least 1 portion")
    .max(100),
  pricePerPortionPounds: z.coerce
    .number()
    .min(0.01, "Enter a price")
    .max(100000),
});

function parseForm(formData: FormData) {
  return commoditySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    imageUrl: formData.get("imageUrl") ?? "",
    baseUnit: formData.get("baseUnit"),
    bulkUnitLabel: formData.get("bulkUnitLabel"),
    portionsPerBulkUnit: formData.get("portionsPerBulkUnit"),
    pricePerPortionPounds: formData.get("pricePerPortionPounds"),
  });
}

export async function createCommodityAction(
  _prev: CommodityState,
  formData: FormData
): Promise<CommodityState> {
  await requireOperator();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const d = parsed.data;
  await prisma.commodity.create({
    data: {
      name: d.name,
      description: d.description ?? "",
      imageUrl: d.imageUrl ? d.imageUrl : null,
      baseUnit: d.baseUnit,
      bulkUnitLabel: d.bulkUnitLabel,
      portionsPerBulkUnit: d.portionsPerBulkUnit,
      pricePerPortion: poundsToPence(d.pricePerPortionPounds),
    },
  });
  revalidatePath("/operator/commodities");
  revalidatePath("/catalog");
  redirect("/operator/commodities");
}

export async function updateCommodityAction(
  id: string,
  _prev: CommodityState,
  formData: FormData
): Promise<CommodityState> {
  await requireOperator();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const d = parsed.data;
  await prisma.commodity.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description ?? "",
      imageUrl: d.imageUrl ? d.imageUrl : null,
      baseUnit: d.baseUnit,
      bulkUnitLabel: d.bulkUnitLabel,
      portionsPerBulkUnit: d.portionsPerBulkUnit,
      pricePerPortion: poundsToPence(d.pricePerPortionPounds),
    },
  });
  revalidatePath("/operator/commodities");
  revalidatePath("/catalog");
  redirect("/operator/commodities");
}

// Operator manually re-runs the merge for a commodity (e.g. after new commits).
export async function runMergeAction(formData: FormData): Promise<void> {
  await requireOperator();
  const commodityId = String(formData.get("commodityId"));
  await tryMergeCommodity(commodityId);
  revalidatePath("/operator/demand");
  revalidatePath("/operator/orders");
}

// Advance an order to the next fulfilment step (paid -> bought ->
// out_for_delivery -> delivered), logging a delivery event members can see.
export async function advanceOrderAction(formData: FormData): Promise<void> {
  await requireOperator();
  const orderId = String(formData.get("orderId"));
  const note = String(formData.get("note") ?? "").trim();

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  const idx = FULFILMENT_STEPS.indexOf(order.status as OrderStatus);
  if (idx < 0 || idx >= FULFILMENT_STEPS.length - 1) return; // nothing to advance
  const next = FULFILMENT_STEPS[idx + 1];

  await prisma.order.update({ where: { id: orderId }, data: { status: next } });
  await prisma.deliveryEvent.create({ data: { orderId, status: next, note } });

  if (next === "delivered") {
    await prisma.basket.updateMany({
      where: { orderId },
      data: { status: "fulfilled" },
    });
  }

  await sendOrderStatusEmails(orderId);

  revalidatePath(`/operator/orders/${orderId}`);
  revalidatePath(`/operator/orders`);
  revalidatePath(`/orders/${orderId}`);
}

// Cancel an order: refund every paid share, mark the order cancelled, and release
// its baskets. Used to unstick orders where members never completed payment.
export async function cancelOrderAction(formData: FormData): Promise<void> {
  await requireOperator();
  const orderId = String(formData.get("orderId"));
  const reason = String(formData.get("reason") ?? "").trim();

  await cancelOrder(orderId, reason || "Order cancelled by operator.");

  revalidatePath(`/operator/orders/${orderId}`);
  revalidatePath(`/operator/orders`);
  revalidatePath(`/orders/${orderId}`);
}

export async function toggleCommodityActiveAction(formData: FormData): Promise<void> {
  await requireOperator();
  const id = String(formData.get("id"));
  const commodity = await prisma.commodity.findUnique({ where: { id } });
  if (!commodity) return;
  await prisma.commodity.update({
    where: { id },
    data: { active: !commodity.active },
  });
  revalidatePath("/operator/commodities");
  revalidatePath("/catalog");
}
