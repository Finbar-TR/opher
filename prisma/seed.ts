import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Accounts: one operator, two members (handy for testing merges).
  await prisma.user.upsert({
    where: { email: "operator@opher.test" },
    update: { role: "operator" },
    create: {
      email: "operator@opher.test",
      name: "Ops Team",
      passwordHash,
      role: "operator",
    },
  });
  await prisma.user.upsert({
    where: { email: "aisha@opher.test" },
    update: {},
    create: { email: "aisha@opher.test", name: "Aisha", passwordHash },
  });
  await prisma.user.upsert({
    where: { email: "ben@opher.test" },
    update: {},
    create: { email: "ben@opher.test", name: "Ben", passwordHash },
  });

  // Operator-curated catalog (prices in pence).
  const commodities = [
    {
      name: "Basmati Rice",
      description: "Long-grain aromatic rice. Bought by the 25kg sack.",
      baseUnit: "kg",
      bulkUnitLabel: "25kg sack",
      portionsPerBulkUnit: 5,
      pricePerPortion: 1200,
    },
    {
      name: "Red Lentils",
      description: "Split red lentils, a store-cupboard staple.",
      baseUnit: "kg",
      bulkUnitLabel: "20kg sack",
      portionsPerBulkUnit: 4,
      pricePerPortion: 900,
    },
    {
      name: "Rapeseed Oil",
      description: "Cold-pressed British rapeseed oil.",
      baseUnit: "L",
      bulkUnitLabel: "20L drum",
      portionsPerBulkUnit: 4,
      pricePerPortion: 1500,
    },
    {
      name: "Plum Tomatoes",
      description: "Tinned Italian plum tomatoes, by the case.",
      baseUnit: "tin",
      bulkUnitLabel: "case of 24",
      portionsPerBulkUnit: 6,
      pricePerPortion: 700,
    },
  ];

  for (const c of commodities) {
    const existing = await prisma.commodity.findFirst({ where: { name: c.name } });
    if (existing) {
      await prisma.commodity.update({ where: { id: existing.id }, data: c });
    } else {
      await prisma.commodity.create({ data: c });
    }
  }

  console.log("Seeded operator + members + catalog.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
