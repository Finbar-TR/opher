"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureStripeCustomer,
  createSetupIntent,
  assertPaymentMethodBelongsTo,
} from "@/lib/payments";
import { joinBasket } from "@/lib/joins";
import { formatAddress } from "@/lib/address";
import { addressSchema, type AddressInput } from "@/lib/join-input";
import { sendJoinConfirmation } from "@/lib/notifications";

// Step one of the join: make sure the customer exists at Stripe and open a
// SetupIntent so the browser can collect a card. Nothing is charged, and no
// order exists yet — a customer who abandons here leaves nothing behind.
export async function startJoin(basketId: string): Promise<{
  clientSecret: string | null;
  setupIntentId: string;
  devPaymentMethodId?: string;
}> {
  const user = await requireUser();

  const basket = await prisma.basket.findUniqueOrThrow({ where: { id: basketId } });
  if (basket.status !== "open") {
    throw new Error("This basket is not open for joins right now.");
  }

  const customerId = await ensureStripeCustomer(user.id, user.email, user.name);
  const si = await createSetupIntent(customerId);

  return {
    clientSecret: si.clientSecret,
    setupIntentId: si.id,
    devPaymentMethodId: si.devPaymentMethodId,
  };
}

// Step two: the browser has confirmed the SetupIntent and holds a
// PaymentMethod. Save the delivery address, then create the order.
//
// The Stripe customer id is re-derived server-side and never taken from the
// client, and the PaymentMethod is verified to belong to it — otherwise a
// crafted request could attach someone else's saved card to its own order.
export async function completeJoin(input: {
  basketId: string;
  tierId: string;
  setupIntentId: string;
  paymentMethodId: string;
  address: AddressInput;
  utm?: { source?: string; medium?: string; campaign?: string };
}): Promise<{ orderId: string }> {
  const user = await requireUser();
  const address = addressSchema.parse(input.address);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      addrLine1: address.addrLine1,
      addrLine2: address.addrLine2 || null,
      addrCity: address.addrCity,
      postcode: address.postcode,
      phone: address.phone,
    },
  });

  const customerId = await ensureStripeCustomer(user.id, user.email, user.name);
  await assertPaymentMethodBelongsTo(customerId, input.paymentMethodId);

  const result = await joinBasket({
    userId: user.id,
    basketId: input.basketId,
    tierId: input.tierId,
    deliveryAddress: formatAddress({
      addrLine1: address.addrLine1,
      addrLine2: address.addrLine2 || null,
      addrCity: address.addrCity,
      postcode: address.postcode,
      phone: address.phone,
    }),
    setupIntentId: input.setupIntentId,
    paymentMethodId: input.paymentMethodId,
    stripeCustomerId: customerId,
    utm: input.utm,
  });

  // The order exists; a failed email must not undo that. Swallow and log.
  try {
    await sendJoinConfirmation(result.orderId);
  } catch (err) {
    console.error(`[email] join confirmation failed for order ${result.orderId}:`, err);
  }

  return result;
}
