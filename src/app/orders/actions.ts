"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { cancelOrder } from "@/lib/joins";

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  // cancelOrder owns the rules: it refuses after the deadline, refuses once a
  // charge has been attempted, and detaches the saved card only when no other
  // order still needs it.
  await cancelOrder(orderId, user.id);

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
