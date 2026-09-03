"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { refundOrder, refundWindow } from "@/lib/refunds";

// Both actions are thin wrappers. `refundOrder` and `refundWindow` own the
// rules — only a charged order can be refunded, and the Stripe call keys its
// own idempotency on the payment intent, so a double submit collapses into one
// refund rather than two.

export async function refundOrderAction(formData: FormData): Promise<void> {
  await requireOperator();
  const orderId = String(formData.get("orderId") ?? "");
  const windowId = String(formData.get("windowId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  await refundOrder(orderId);

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}

export async function refundWindowAction(formData: FormData): Promise<void> {
  await requireOperator();
  const windowId = String(formData.get("windowId") ?? "");
  if (!windowId) throw new Error("Missing delivery.");

  await refundWindow(windowId);

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}
