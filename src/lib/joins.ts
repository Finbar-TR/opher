import "server-only";
import { prisma } from "./prisma";
import { detachPaymentMethod } from "./payments";

// Joining a basket IS the order — there is no cart. The card is saved at join
// and charged at the window's cutoff, so a join costs the customer nothing
// until then.

export type JoinParams = {
  userId: string;
  basketId: string;
  tierId: string;
  deliveryAddress: string;
  setupIntentId: string;
  paymentMethodId: string;
  stripeCustomerId: string;
  utm?: { source?: string; medium?: string; campaign?: string };
};

export async function joinBasket(params: JoinParams): Promise<{ orderId: string }> {
  const basket = await prisma.basket.findUniqueOrThrow({
    where: { id: params.basketId },
    include: { city: true },
  });
  if (basket.status !== "open") {
    throw new Error("This basket is not open for joins right now.");
  }

  const tier = await prisma.basketTier.findUniqueOrThrow({ where: { id: params.tierId } });
  if (tier.basketId !== basket.id || !tier.active) {
    throw new Error("That option is no longer available.");
  }

  // The soonest open window for the basket's city. Re-read at submit time so a
  // window that locked while the user was filling the form is caught here.
  const window = await prisma.deliveryWindow.findFirst({
    where: { cityId: basket.cityId, status: "open" },
    orderBy: { deliveryDate: "asc" },
  });
  if (!window) {
    throw new Error("Joining is closed for this delivery. Check back for the next one.");
  }

  const existing = await prisma.order.findUnique({
    where: {
      userId_basketId_deliveryWindowId: {
        userId: params.userId,
        basketId: basket.id,
        deliveryWindowId: window.id,
      },
    },
  });
  if (existing && existing.status !== "cancelled") {
    throw new Error("You've already joined this basket for this delivery.");
  }

  const fields = {
    basketTierId: tier.id,
    status: "committed",
    stripeCustomerId: params.stripeCustomerId,
    stripeSetupIntentId: params.setupIntentId,
    stripePaymentMethodId: params.paymentMethodId,
    // Both derive from the window's cutoff: one date, not two.
    debitDate: window.cutoffAt,
    cancellationDeadline: window.cutoffAt,
    totalPence: tier.pricePence, // snapshot, so later price edits don't apply
    deliveryAddress: params.deliveryAddress,
    utmSource: params.utm?.source ?? null,
    utmMedium: params.utm?.medium ?? null,
    utmCampaign: params.utm?.campaign ?? null,
  };

  // Someone who cancelled and changed their mind reuses their existing row —
  // the unique key on (user, basket, window) means a second insert would fail.
  const order = existing
    ? await prisma.order.update({
        where: { id: existing.id },
        data: { ...fields, paymentAttemptedAt: null, paymentRetryCount: 0 },
      })
    : await prisma.order.create({
        data: {
          userId: params.userId,
          basketId: basket.id,
          deliveryWindowId: window.id,
          ...fields,
        },
      });

  return { orderId: order.id };
}

export async function cancelOrder(
  orderId: string,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.userId !== userId) throw new Error("That isn't your order.");

  // Never unwind an order a charge has been attempted on, even a failed one —
  // the retry flow owns those, and an admin refund handles the rest.
  if (order.status !== "committed" || order.paymentAttemptedAt) {
    throw new Error("This order cannot be cancelled.");
  }
  if (now >= order.cancellationDeadline) {
    throw new Error("The cancellation deadline has passed.");
  }

  const paymentMethodId = order.stripePaymentMethodId;

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "cancelled", stripePaymentMethodId: null },
  });

  // Detach only when nothing else still needs this card: a user with two
  // committed joins shares one saved card, and detaching unconditionally would
  // silently break the charge for the other one.
  if (paymentMethodId) {
    const stillInUse = await prisma.order.count({
      where: {
        userId,
        stripePaymentMethodId: paymentMethodId,
        status: { in: ["committed", "payment_pending", "payment_failed"] },
      },
    });
    if (stillInUse === 0) await detachPaymentMethod(paymentMethodId);
  }
}

// Stripe's setup_intent.succeeded arriving after the join request already wrote
// the order. The order is NOT created here: doing so would race the
// confirmation screen, and a slow webhook would be indistinguishable from a
// lost order. This only fills a gap the join request left.
//
// Idempotent, and safe to receive more than once: stripeSetupIntentId is unique.
export async function reconcileSetupIntent(
  setupIntentId: string,
  paymentMethodId: string
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { stripeSetupIntentId: setupIntentId },
  });

  if (!order) {
    // An orphaned SetupIntent: the customer abandoned the flow after Stripe
    // confirmed. Nothing to do, but worth seeing in the logs.
    console.warn(`[stripe] setup_intent ${setupIntentId} has no order`);
    return;
  }

  if (order.stripePaymentMethodId) return;

  await prisma.order.update({
    where: { id: order.id },
    data: { stripePaymentMethodId: paymentMethodId },
  });
}
