import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();
const code = () => randomBytes(4).toString("hex").toUpperCase();

async function main() {
  const [aisha, ben, rice] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "aisha@opher.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "ben@opher.test" } }),
    prisma.commodity.findFirstOrThrow({ where: { name: "Basmati Rice" } }),
  ]);

  // 1) An open basket to exercise the ledger + claim/invite/commit UI.
  const open = await prisma.basket.create({
    data: {
      commodityId: rice.id,
      organiserId: aisha.id,
      title: "Elm Street neighbours",
      targetPortions: 5,
      status: "open",
      inviteCode: code(),
      claims: { create: { userId: aisha.id, portions: 2 } },
    },
  });

  // 2) A merged order mid-delivery (status "bought"), from two baskets.
  const order = await prisma.order.create({
    data: { commodityId: rice.id, bulkUnits: 1, status: "bought" },
  });
  await prisma.basket.create({
    data: {
      commodityId: rice.id,
      organiserId: ben.id,
      title: "Oak Court",
      targetPortions: 3,
      status: "ordered",
      inviteCode: code(),
      orderId: order.id,
      claims: { create: { userId: ben.id, portions: 3 } },
    },
  });
  await prisma.basket.create({
    data: {
      commodityId: rice.id,
      organiserId: aisha.id,
      title: "Maple Flat",
      targetPortions: 2,
      status: "ordered",
      inviteCode: code(),
      orderId: order.id,
      claims: { create: { userId: aisha.id, portions: 2 } },
    },
  });
  await prisma.payment.createMany({
    data: [
      { orderId: order.id, userId: ben.id, portions: 3, amount: 3 * rice.pricePerPortion, status: "paid" },
      { orderId: order.id, userId: aisha.id, portions: 2, amount: 2 * rice.pricePerPortion, status: "paid" },
    ],
  });
  await prisma.deliveryEvent.createMany({
    data: [
      { orderId: order.id, status: "paid", note: "All shares paid." },
      { orderId: order.id, status: "bought", note: "Collected from supplier." },
    ],
  });

  console.log("OPEN_BASKET=" + open.id);
  console.log("ORDER=" + order.id);
  console.log("COMMODITY=" + rice.id);
  await prisma.$disconnect();
}

main();
