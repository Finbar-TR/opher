"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { refundOrder, refundWindow } from "@/lib/refunds";

// Both actions are thin wrappers. `refundOrder` and `refundWindow` own the
// rules — only a charged order can be refunded, and the Stripe call keys its
// own idempotency on the payment intent, so a double submit collapses into one
// refund rather than two.
//
// These keep THROWING rather than returning form state. A refund failing is not
// a routine operator mistake like a mistyped price — it is Stripe or the
// database misbehaving, and the error boundary is the right place for it. What
// the boundary cannot do is show the real message in production, so each throw
// is logged here first: the digest the operator reads on screen matches this
// line in the server log.

export async function refundOrderAction(formData: FormData): Promise<void> {
  await requireOperator();
  const orderId = String(formData.get("orderId") ?? "");
  const windowId = String(formData.get("windowId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  try {
    await refundOrder(orderId);
  } catch (err) {
    console.error("[operator] refundOrderAction failed", { orderId }, err);
    throw err;
  }

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}

export async function refundWindowAction(formData: FormData): Promise<void> {
  await requireOperator();
  const windowId = String(formData.get("windowId") ?? "");
  if (!windowId) throw new Error("Missing delivery.");

  try {
    await refundWindow(windowId);
  } catch (err) {
    console.error("[operator] refundWindowAction failed", { windowId }, err);
    throw err;
  }

  revalidatePath(`/operator/cycles/${windowId}`);
  revalidatePath("/orders");
}
