import "server-only";
import { prisma } from "./prisma";
import { mergeBaskets, type MergeInput } from "./merge";
import { formatAddress } from "./address";
import { sendOrderCreatedEmails } from "./notifications";
import { daysFromNow } from "./dates";
import { ORDER_PAYMENT_DUE_DAYS } from "./constants";

// Run the merge engine over all committed, un-ordered baskets for a commodity
// and persist an Order for each whole bulk unit that can be completed.
//
// Each basket contributes its total claimed portions. For every group the engine
// returns, we create one Order, link its baskets (status -> "ordered"), and
// create an unpaid Payment per participant (collect-on-order). Returns the number
// of orders created.
export async function tryMergeCommodity(commodityId: string): Promise<number> {
  const commodity = await prisma.commodity.findUnique({
    where: { id: commodityId },
  });
  if (!commodity) return 0;

  const baskets = await prisma.basket.findMany({
    where: { commodityId, status: "committed", orderId: null },
    include: { claims: true },
  });

  const inputs: MergeInput[] = baskets.map((b) => ({
    basketId: b.id,
    portions: b.claims.reduce((s, c) => s + c.portions, 0),
  }));

  const { groups } = mergeBaskets(inputs, commodity.portionsPerBulkUnit);

  const createdOrderIds: string[] = [];
  for (const group of groups) {
    const orderId = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          commodityId,
          bulkUnits: 1,
          status: "pending_payment",
          paymentDueAt: daysFromNow(ORDER_PAYMENT_DUE_DAYS),
        },
      });

      await tx.basket.updateMany({
        where: { id: { in: group.basketIds } },
        data: { orderId: order.id, status: "ordered" },
      });

      // Aggregate portions per participant across every basket in the group,
      // so a person appearing in two merged baskets pays once.
      const claims = await tx.portionClaim.findMany({
        where: { basketId: { in: group.basketIds } },
      });
      const perUser = new Map<string, number>();
      for (const c of claims) {
        perUser.set(c.userId, (perUser.get(c.userId) ?? 0) + c.portions);
      }

      const users = await tx.user.findMany({
        where: { id: { in: [...perUser.keys()] } },
      });
      const addressById = new Map(users.map((u) => [u.id, formatAddress(u)]));

      for (const [userId, portions] of perUser) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            userId,
            portions,
            amount: portions * commodity.pricePerPortion,
            status: "unpaid",
            deliveryAddress: addressById.get(userId) || null,
          },
        });
      }

      return order.id;
    });
    createdOrderIds.push(orderId);
  }

  for (const id of createdOrderIds) {
    await sendOrderCreatedEmails(id);
  }

  return createdOrderIds.length;
}
