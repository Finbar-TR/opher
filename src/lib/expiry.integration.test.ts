import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { runExpiry } from "./expiry";
import { generateInviteCode } from "./ids";

// Verifies the scheduled expiry sweep against a real database, using isolated
// rows with deadlines set in the past. Rows without a deadline (null) must be
// left untouched.

const TAG = "ZZEXP_" + Date.now();
const past = new Date(Date.now() - 60_000);
let commodityId = "";
let userId = "";
let staleBasketId = "";
let staleOrderId = "";
let freshBasketId = "";

beforeAll(async () => {
  const commodity = await prisma.commodity.create({
    data: {
      name: `${TAG} Oil`,
      baseUnit: "L",
      bulkUnitLabel: "20L drum",
      portionsPerBulkUnit: 4,
      pricePerPortion: 1500,
    },
  });
  commodityId = commodity.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}@test`, name: "Test", passwordHash: "x" },
  });
  userId = user.id;

  // An expired open basket that never merged.
  const stale = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: userId,
      title: `${TAG} stale`,
      targetPortions: 4,
      status: "open",
      inviteCode: generateInviteCode(),
      expiresAt: past,
      claims: { create: { userId, portions: 2 } },
    },
  });
  staleBasketId = stale.id;

  // A basket with no deadline — must survive the sweep.
  const fresh = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: userId,
      title: `${TAG} fresh`,
      targetPortions: 4,
      status: "open",
      inviteCode: generateInviteCode(),
      expiresAt: null,
      claims: { create: { userId, portions: 1 } },
    },
  });
  freshBasketId = fresh.id;

  // An expired pending_payment order with a paid share (to test refund).
  const order = await prisma.order.create({
    data: {
      commodityId,
      bulkUnits: 1,
      status: "pending_payment",
      paymentDueAt: past,
    },
  });
  staleOrderId = order.id;
  await prisma.payment.create({
    data: {
      orderId: order.id,
      userId,
      portions: 4,
      amount: 4 * 1500,
      status: "paid",
    },
  });
});

afterAll(async () => {
  await prisma.deliveryEvent.deleteMany({ where: { orderId: staleOrderId } });
  await prisma.payment.deleteMany({ where: { orderId: staleOrderId } });
  await prisma.portionClaim.deleteMany({
    where: { basketId: { in: [staleBasketId, freshBasketId] } },
  });
  await prisma.basket.deleteMany({ where: { commodityId } });
  await prisma.order.deleteMany({ where: { commodityId } });
  await prisma.commodity.delete({ where: { id: commodityId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("runExpiry", () => {
  it("cancels expired baskets and orders, refunds paid shares, spares dated-null rows", async () => {
    const result = await runExpiry();
    expect(result.basketsCancelled).toBeGreaterThanOrEqual(1);
    expect(result.ordersCancelled).toBeGreaterThanOrEqual(1);

    const stale = await prisma.basket.findUniqueOrThrow({
      where: { id: staleBasketId },
    });
    expect(stale.status).toBe("cancelled");

    const fresh = await prisma.basket.findUniqueOrThrow({
      where: { id: freshBasketId },
    });
    expect(fresh.status).toBe("open"); // no deadline → untouched

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: staleOrderId },
    });
    expect(order.status).toBe("cancelled");

    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: staleOrderId },
    });
    expect(payment.status).toBe("refunded");
  });
});
