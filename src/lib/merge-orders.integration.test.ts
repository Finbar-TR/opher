import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { tryMergeCommodity } from "./merge-orders";
import { markPaymentPaid, refundPayment } from "./orders";
import { generateInviteCode } from "./ids";

// End-to-end check of the commit → merge → order → payment-settle path against a
// real SQLite database, using isolated test rows that are cleaned up afterwards.

const TAG = "ZZTEST_" + Date.now();
let commodityId = "";
let aishaId = "";
let benId = "";
let basketAId = "";
let basketBId = "";

beforeAll(async () => {
  const commodity = await prisma.commodity.create({
    data: {
      name: `${TAG} Rice`,
      baseUnit: "kg",
      bulkUnitLabel: "25kg sack",
      portionsPerBulkUnit: 5,
      pricePerPortion: 1200, // £12.00
    },
  });
  commodityId = commodity.id;

  const aisha = await prisma.user.create({
    data: {
      email: `${TAG}-aisha@test`,
      name: "Aisha",
      passwordHash: "x",
      addrLine1: "221B Baker Street",
      addrCity: "London",
      postcode: "NW1 6XE",
      phone: "07700 900000",
    },
  });
  const ben = await prisma.user.create({
    data: { email: `${TAG}-ben@test`, name: "Ben", passwordHash: "x" },
  });
  aishaId = aisha.id;
  benId = ben.id;

  // Two complementary committed baskets: 2 portions + 3 portions = one 5-portion sack.
  const a = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: aishaId,
      title: `${TAG} A`,
      targetPortions: 5,
      status: "committed",
      inviteCode: generateInviteCode(),
      claims: { create: { userId: aishaId, portions: 2 } },
    },
  });
  const b = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: benId,
      title: `${TAG} B`,
      targetPortions: 5,
      status: "committed",
      inviteCode: generateInviteCode(),
      claims: { create: { userId: benId, portions: 3 } },
    },
  });
  basketAId = a.id;
  basketBId = b.id;
});

afterAll(async () => {
  await prisma.deliveryEvent.deleteMany({
    where: { order: { commodityId } },
  });
  await prisma.payment.deleteMany({ where: { order: { commodityId } } });
  await prisma.portionClaim.deleteMany({
    where: { basketId: { in: [basketAId, basketBId] } },
  });
  await prisma.basket.deleteMany({ where: { commodityId } });
  await prisma.order.deleteMany({ where: { commodityId } });
  await prisma.commodity.delete({ where: { id: commodityId } });
  await prisma.user.deleteMany({ where: { id: { in: [aishaId, benId] } } });
  await prisma.$disconnect();
});

describe("commit → merge → order → payment", () => {
  it("merges 2/5 + 3/5 into one order with correct payments", async () => {
    const created = await tryMergeCommodity(commodityId);
    expect(created).toBe(1);

    const order = await prisma.order.findFirst({
      where: { commodityId },
      include: { payments: true, baskets: true },
    });
    expect(order).not.toBeNull();
    expect(order!.status).toBe("pending_payment");
    expect(order!.baskets).toHaveLength(2);

    // Both baskets linked and marked ordered.
    for (const b of order!.baskets) {
      expect(b.status).toBe("ordered");
      expect(b.orderId).toBe(order!.id);
    }

    // One payment per participant, priced at £12/portion.
    const byUser = Object.fromEntries(
      order!.payments.map((p) => [p.userId, p])
    );
    expect(order!.payments).toHaveLength(2);
    expect(byUser[aishaId].amount).toBe(2 * 1200);
    expect(byUser[benId].amount).toBe(3 * 1200);

    // Aisha's delivery address is snapshotted onto her payment.
    expect(byUser[aishaId].deliveryAddress).toContain("221B Baker Street");
    expect(byUser[aishaId].deliveryAddress).toContain("NW1 6XE");
  });

  it("settles the order to 'paid' only once every share is paid", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { commodityId } });
    const payments = await prisma.payment.findMany({
      where: { orderId: order.id },
    });

    // Pay the first share — order should still be awaiting payment.
    await markPaymentPaid(payments[0].id);
    let refreshed = await prisma.order.findFirstOrThrow({
      where: { id: order.id },
    });
    expect(refreshed.status).toBe("pending_payment");

    // Pay the second — order settles and logs a delivery event.
    await markPaymentPaid(payments[1].id);
    refreshed = await prisma.order.findFirstOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe("paid");

    const events = await prisma.deliveryEvent.findMany({
      where: { orderId: order.id },
    });
    expect(events.some((e) => e.status === "paid")).toBe(true);
  });

  it("refunds a paid share (dev path marks it refunded)", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { commodityId } });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, userId: aishaId },
    });
    expect(payment.status).toBe("paid");

    await refundPayment(payment.id);

    const after = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(after.status).toBe("refunded");
  });
});
