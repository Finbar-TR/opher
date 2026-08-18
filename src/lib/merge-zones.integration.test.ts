import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { tryMergeCommodity } from "./merge-orders";
import { generateInviteCode } from "./ids";

// Verifies the zone-aware merge: baskets merge only within a delivery zone,
// merge-opted-out baskets stay solo, organisers get free delivery, and orders
// carry a projected delivery date.

const TAG = "ZZZONE_" + Date.now();
let commodityId = "";
const u: Record<string, string> = {};
const b: Record<string, string> = {};

async function mkUser(key: string) {
  const user = await prisma.user.create({
    data: { email: `${TAG}-${key}@test`, name: key, passwordHash: "x" },
  });
  u[key] = user.id;
}

async function mkBasket(
  key: string,
  zone: string,
  organiser: string,
  allowMerge: boolean,
  claims: [string, number][]
) {
  const basket = await prisma.basket.create({
    data: {
      commodityId,
      organiserId: u[organiser],
      title: `${TAG} ${key}`,
      targetPortions: 5,
      status: "committed",
      allowMerge,
      outwardCode: zone,
      inviteCode: generateInviteCode(),
      claims: { create: claims.map(([who, p]) => ({ userId: u[who], portions: p })) },
    },
  });
  b[key] = basket.id;
}

beforeAll(async () => {
  const commodity = await prisma.commodity.create({
    data: {
      name: `${TAG} Rice`,
      baseUnit: "kg",
      bulkUnitLabel: "25kg sack",
      portionsPerBulkUnit: 5,
      pricePerPortion: 1000,
      deliveryFee: 300,
      deliveryLeadDays: 5,
    },
  });
  commodityId = commodity.id;

  for (const k of ["aisha", "carol", "ben", "dave", "erin"]) await mkUser(k);

  // A: M14, fills a whole unit alone (organiser aisha 2 + member carol 3).
  await mkBasket("A", "M14", "aisha", true, [["aisha", 2], ["carol", 3]]);
  // B: different zone, partial — must not merge with M14.
  await mkBasket("B", "BS1", "ben", true, [["ben", 3]]);
  // C: M14 but opted out of merging, partial — stays solo.
  await mkBasket("C", "M14", "dave", false, [["dave", 2]]);
  // D: M14 partial — its only same-zone complement (C) opted out, so it can't complete.
  await mkBasket("D", "M14", "erin", true, [["erin", 3]]);
});

afterAll(async () => {
  await prisma.deliveryEvent.deleteMany({ where: { order: { commodityId } } });
  await prisma.payment.deleteMany({ where: { order: { commodityId } } });
  await prisma.portionClaim.deleteMany({ where: { basket: { commodityId } } });
  await prisma.basket.deleteMany({ where: { commodityId } });
  await prisma.order.deleteMany({ where: { commodityId } });
  await prisma.commodity.delete({ where: { id: commodityId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  await prisma.$disconnect();
});

describe("zone-aware merge", () => {
  it("merges only within a zone, respects opt-out, and waives organiser delivery", async () => {
    const created = await tryMergeCommodity(commodityId);
    expect(created).toBe(1); // only basket A completes a unit

    const order = await prisma.order.findFirstOrThrow({
      where: { commodityId },
      include: { payments: true, baskets: true },
    });
    expect(order.outwardCode).toBe("M14");
    expect(order.estimatedDeliveryAt).not.toBeNull();
    expect(order.baskets.map((x) => x.id)).toEqual([b.A]);

    const byUser = Object.fromEntries(order.payments.map((p) => [p.userId, p]));
    // Organiser (aisha): delivery waived.
    expect(byUser[u.aisha].deliveryFee).toBe(0);
    expect(byUser[u.aisha].amount).toBe(2 * 1000);
    // Member (carol): pays the delivery fee.
    expect(byUser[u.carol].deliveryFee).toBe(300);
    expect(byUser[u.carol].amount).toBe(3 * 1000 + 300);

    // B (other zone), C (opted out), D (no complement) all remain committed.
    for (const key of ["B", "C", "D"]) {
      const basket = await prisma.basket.findUniqueOrThrow({ where: { id: b[key] } });
      expect(basket.status).toBe("committed");
      expect(basket.orderId).toBeNull();
    }
  });
});
