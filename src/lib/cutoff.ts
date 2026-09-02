// The cutoff-day decision, as pure logic. Given how much demand a basket
// gathered and what supply is available, decide whether the cycle goes ahead
// and how much to buy. No database access, no Stripe.
//
// Nothing here charges anybody: the decision is deliberately taken BEFORE any
// money moves, which is what makes a failed cycle free for the customer.

export type SupplyFacts = {
  stockAt3pl: number; // grams currently held at the 3PL
  leadTimeDays: number; // days from raising a PO to goods being at the 3PL
  purchaseThresholdGrams: number; // demand needed before we buy at all
};

export type CycleDecision = {
  outcome: "confirmed" | "failed";
  reason: "met" | "below_threshold" | "not_suppliable";
  purchaseGrams: number; // 0 when fulfilled entirely from held stock
};

// Supply is feasible either because we already hold enough, or because we can
// buy it in time for this delivery.
function isSuppliable(
  demandedGrams: number,
  supply: SupplyFacts,
  cutoffDays: number
): boolean {
  if (supply.stockAt3pl >= demandedGrams) return true;
  return supply.leadTimeDays <= cutoffDays;
}

export function decideCycle(
  demandedGrams: number,
  supply: SupplyFacts,
  cutoffDays: number
): CycleDecision {
  if (demandedGrams < supply.purchaseThresholdGrams) {
    return { outcome: "failed", reason: "below_threshold", purchaseGrams: 0 };
  }

  if (!isSuppliable(demandedGrams, supply, cutoffDays)) {
    return { outcome: "failed", reason: "not_suppliable", purchaseGrams: 0 };
  }

  // Held stock reduces what we buy; it is not decremented here. Stock moves
  // only when goods physically arrive (PO received) or leave (orders dispatch).
  const purchaseGrams = Math.max(0, demandedGrams - supply.stockAt3pl);
  return { outcome: "confirmed", reason: "met", purchaseGrams };
}
