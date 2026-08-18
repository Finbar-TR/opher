import "server-only";
import { prisma } from "./prisma";
import { mergeBaskets, type MergeInput, type MergeGroup } from "./merge";
import { formatAddress } from "./address";
import { sendOrderCreatedEmails } from "./notifications";
import { daysFromNow } from "./dates";
import { ORDER_PAYMENT_DUE_DAYS } from "./constants";

// Run the merge engine over committed, un-ordered baskets for a commodity and
// persist an Order for each whole bulk unit that can be completed.
//
// Baskets are merged only within the same delivery zone (outward postcode), so a
// merged order is geographically coherent for a single delivery run. A basket that
// opted out of merging (`allowMerge = false`) only forms its own order if it fills a
// whole unit alone. Each order carries a projected delivery date, and the organiser
// of each merged basket gets their delivery fee waived. Returns orders created.
export async function tryMergeCommodity(commodityId: string): Promise<number> {
  const commodity = await prisma.commodity.findUnique({
    where: { id: commodityId },
  });
  if (!commodity) return 0;

  const baskets = await prisma.basket.findMany({
    where: { commodityId, status: "committed", orderId: null },
    include: { claims: true },
  });

  const unit = commodity.portionsPerBulkUnit;
  const portionsOf = (b: (typeof baskets)[number]) =>
    b.claims.reduce((s, c) => s + c.portions, 0);

  // Group by delivery zone (null outward code buckets together under "").
  const zones = new Map<string, typeof baskets>();
  for (const b of baskets) {
    const key = b.outwardCode ?? "";
    (zones.get(key) ?? zones.set(key, []).get(key)!).push(b);
  }

  const createdOrderIds: string[] = [];

  for (const [zoneKey, zoneBaskets] of zones) {
    const outward = zoneKey || null;

    // Consent: merge-opted-out baskets can only become their own whole-unit order.
    const poolable = zoneBaskets.filter((b) => b.allowMerge);
    const soloOnly = zoneBaskets.filter((b) => !b.allowMerge);

    const groups: MergeGroup[] = [];
    for (const b of soloOnly) {
      if (portionsOf(b) === unit) {
        groups.push({ basketIds: [b.id], portions: unit });
      }
    }
    const inputs: MergeInput[] = poolable.map((b) => ({
      basketId: b.id,
      portions: portionsOf(b),
    }));
    groups.push(...mergeBaskets(inputs, unit).groups);

    for (const group of groups) {
      const orderId = await createOrderForGroup(commodity, group, outward);
      createdOrderIds.push(orderId);
    }
  }

  for (const id of createdOrderIds) {
    await sendOrderCreatedEmails(id);
  }

  return createdOrderIds.length;
}

async function createOrderForGroup(
  commodity: {
    id: string;
    pricePerPortion: number;
    deliveryFee: number;
    deliveryLeadDays: number;
  },
  group: MergeGroup,
  outward: string | null
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        commodityId: commodity.id,
        bulkUnits: 1,
        status: "pending_payment",
        outwardCode: outward,
        paymentDueAt: daysFromNow(ORDER_PAYMENT_DUE_DAYS),
        estimatedDeliveryAt: daysFromNow(commodity.deliveryLeadDays),
      },
    });

    await tx.basket.updateMany({
      where: { id: { in: group.basketIds } },
      data: { orderId: order.id, status: "ordered" },
    });

    const groupBaskets = await tx.basket.findMany({
      where: { id: { in: group.basketIds } },
      include: { claims: true },
    });
    // Organisers of any merged basket get free delivery (their reward).
    const organiserIds = new Set(groupBaskets.map((b) => b.organiserId));

    // Aggregate portions per participant across the merged baskets.
    const perUser = new Map<string, number>();
    for (const b of groupBaskets) {
      for (const c of b.claims) {
        perUser.set(c.userId, (perUser.get(c.userId) ?? 0) + c.portions);
      }
    }

    const users = await tx.user.findMany({
      where: { id: { in: [...perUser.keys()] } },
    });
    const addressById = new Map(users.map((u) => [u.id, formatAddress(u)]));

    for (const [userId, portions] of perUser) {
      const fee = organiserIds.has(userId) ? 0 : commodity.deliveryFee;
      await tx.payment.create({
        data: {
          orderId: order.id,
          userId,
          portions,
          deliveryFee: fee,
          amount: portions * commodity.pricePerPortion + fee,
          status: "unpaid",
          deliveryAddress: addressById.get(userId) || null,
        },
      });
    }

    return order.id;
  });
}
