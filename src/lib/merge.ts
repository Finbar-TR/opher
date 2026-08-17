// The merge engine — Opher's flagship feature.
//
// Committed baskets for the same commodity each contribute a number of portions
// (1..portionsPerBulkUnit). This finds groups of baskets whose portions sum to
// exactly one whole bulk unit, so a full unit can be bought and split back out.
//
// Example: a basket with 2 portions and a basket with 3 portions, where a bulk
// unit is 5 portions, merge into one order (2/5 + 3/5 = 5/5). Baskets that can't
// be completed into a whole unit are left open, awaiting a future complement.
//
// This module is pure (no I/O) so it can be tested in isolation and reused by the
// server action that persists the resulting orders.

export type MergeInput = { basketId: string; portions: number };
export type MergeGroup = { basketIds: string[]; portions: number };
export type MergeResult = { groups: MergeGroup[]; leftover: MergeInput[] };

/**
 * Partition baskets into groups that each sum to exactly `portionsPerBulkUnit`.
 *
 * Strategy (kept deliberately simple for v1): baskets that already fill a whole
 * unit become their own group; the remaining partials are packed greedily by
 * exact subset-sum, preferring to seed each group with the largest remaining
 * basket. Anything that can't complete a whole unit stays in `leftover`.
 *
 * Portion counts are small, so the exhaustive subset search is cheap.
 */
export function mergeBaskets(
  baskets: MergeInput[],
  portionsPerBulkUnit: number
): MergeResult {
  if (portionsPerBulkUnit <= 0) {
    return { groups: [], leftover: [...baskets] };
  }

  const groups: MergeGroup[] = [];
  const leftover: MergeInput[] = [];

  // Whole-unit baskets order on their own; empty or oversized inputs can't merge
  // (app code caps a basket at one unit) so they go straight to leftover.
  let remaining: MergeInput[] = [];
  for (const b of baskets) {
    if (b.portions === portionsPerBulkUnit) {
      groups.push({ basketIds: [b.basketId], portions: b.portions });
    } else if (b.portions > 0 && b.portions < portionsPerBulkUnit) {
      remaining.push(b);
    } else {
      leftover.push(b);
    }
  }

  // Greedily seed a group with the largest remaining partial, then look for a
  // subset of the rest that completes it to exactly one unit.
  while (remaining.length > 0) {
    const sorted = [...remaining].sort((a, b) => b.portions - a.portions);
    const seed = sorted[0];
    const pool = sorted.slice(1);

    const complement = findSubsetSummingTo(
      pool,
      portionsPerBulkUnit - seed.portions
    );

    if (complement) {
      const groupItems = [seed, ...complement];
      groups.push({
        basketIds: groupItems.map((g) => g.basketId),
        portions: portionsPerBulkUnit,
      });
      const used = new Set(groupItems.map((g) => g.basketId));
      remaining = remaining.filter((r) => !used.has(r.basketId));
    } else {
      // The largest remaining basket can't be completed; set it aside and retry
      // with the rest so smaller baskets still get a chance to combine.
      remaining = remaining.filter((r) => r.basketId !== seed.basketId);
      leftover.push(seed);
    }
  }

  return { groups, leftover };
}

/**
 * Find any subset of `items` whose portions sum exactly to `target`.
 * Returns the subset, or null if none exists. `target` of 0 → empty subset.
 */
function findSubsetSummingTo(
  items: MergeInput[],
  target: number
): MergeInput[] | null {
  if (target === 0) return [];
  if (target < 0 || items.length === 0) return null;

  // Depth-first search over include/exclude of each item.
  function search(index: number, remainingTarget: number): MergeInput[] | null {
    if (remainingTarget === 0) return [];
    if (index >= items.length || remainingTarget < 0) return null;

    const item = items[index];
    // Try including this item.
    if (item.portions <= remainingTarget) {
      const rest = search(index + 1, remainingTarget - item.portions);
      if (rest) return [item, ...rest];
    }
    // Otherwise exclude it.
    return search(index + 1, remainingTarget);
  }

  return search(0, target);
}
