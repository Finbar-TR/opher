"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { cancelOrder } from "@/lib/joins";

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) throw new Error("Missing order.");

  // cancelOrder owns the rules: it refuses after the deadline, refuses once a
  // charge has been attempted, and detaches the saved card only when no other
  // order still needs it. In particular it can lose a race to the cutoff cron,
  // which claims the row between our guard read and its write — that failure
  // is expected, not exceptional, so we route it back to the order page with
  // a reason rather than letting it fall through to the default error screen.
  let failed = false;
  try {
    await cancelOrder(orderId, user.id);
  } catch {
    failed = true;
  }

  if (failed) {
    // redirect() throws a Next.js control-flow signal — it must not be called
    // inside the try/catch above, or this catch would swallow it too.
    redirect(`/orders/${orderId}?cancelFailed=1`);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
