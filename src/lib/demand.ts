import "server-only";
import { prisma } from "./prisma";
import { DEMAND_COUNTED_STATUSES } from "./constants";

// How many grams a basket has gathered for one delivery window.
//
// Computed from orders rather than kept as a running total: a stored counter
// incremented on join and decremented on cancel has two writers, no transaction
// boundary, and drifts silently — and this number drives purchase decisions.
export async function demandedGrams(
  basketId: string,
  windowId: string
): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      basketId,
      deliveryWindowId: windowId,
      status: { in: DEMAND_COUNTED_STATUSES },
    },
    select: { tier: { select: { weightGrams: true } } },
  });

  return orders.reduce((total, o) => total + o.tier.weightGrams, 0);
}
