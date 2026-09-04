import { poundsToPence } from "./money";
import { kgToGrams } from "./weight";

// The tier rows of the basket form, parsed away from the server action so the
// domain rules can be tested without faking `requireOperator` or a database.
// The action is then just: parse, check the clash, write.

// 2–4 tiers, per the design. One tier is a shop, not a basket; more than four
// is a menu nobody reads on a phone.
export const MIN_TIERS = 2;
export const MAX_TIERS = 4;

// Ceilings, not opinions about food. `weightGrams` and `pricePence` are Prisma
// `Int`s — 32-bit — so without a bound a fat-fingered "1000000000" reaches the
// database as a raw driver error instead of a sentence the operator can act on.
// These sit far below the 2,147,483,647 limit with room to spare.
export const MAX_TIER_WEIGHT_KG = 1000;
export const MAX_TIER_PRICE_POUNDS = 10_000;

export type ParsedTier = {
  label: string;
  weightGrams: number;
  pricePence: number;
};

export type ParseTiersResult =
  | { ok: true; tiers: ParsedTier[] }
  | { ok: false; message: string };

// Parses the three parallel arrays the form posts — tierLabel[],
// tierWeightKg[], tierPricePounds[] — into storage units.
//
// A row is dropped only when EVERY field is blank. The form renders empty rows
// up front, so blank ones must vanish; but the previous rule dropped on a blank
// label alone, which silently threw away a row where the operator had typed a
// weight and a price and only missed the name. Losing a size the operator
// believes they created is worse than making them fix it.
export function parseTiers(
  labels: readonly string[],
  weights: readonly string[],
  prices: readonly string[]
): ParseTiersResult {
  const rowCount = Math.max(labels.length, weights.length, prices.length);

  const rows: { label: string; weight: string; price: string }[] = [];
  for (let i = 0; i < rowCount; i++) {
    const label = (labels[i] ?? "").trim();
    const weight = (weights[i] ?? "").trim();
    const price = (prices[i] ?? "").trim();
    if (label === "" && weight === "" && price === "") continue;
    rows.push({ label, weight, price });
  }

  if (rows.length < MIN_TIERS || rows.length > MAX_TIERS) {
    return {
      ok: false,
      message: `A basket needs between ${MIN_TIERS} and ${MAX_TIERS} sizes.`,
    };
  }

  const tiers: ParsedTier[] = [];

  for (const [i, row] of rows.entries()) {
    // Rows are unnumbered on screen, so name the row by its position — an
    // operator scanning the form needs to find the one that is wrong.
    const where = row.label !== "" ? `"${row.label}"` : `Size ${i + 1}`;

    if (row.label === "" || row.weight === "" || row.price === "") {
      return {
        ok: false,
        message: `${where} needs a name, a weight and a price — fill it in or clear the row.`,
      };
    }

    const weightKg = Number(row.weight);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return { ok: false, message: `${where} needs a weight in kg above zero.` };
    }
    if (weightKg > MAX_TIER_WEIGHT_KG) {
      return {
        ok: false,
        message: `${where} is over ${MAX_TIER_WEIGHT_KG} kg — that is not a basket size.`,
      };
    }

    const pricePounds = Number(row.price);
    if (!Number.isFinite(pricePounds) || pricePounds <= 0) {
      return { ok: false, message: `${where} needs a price above zero.` };
    }
    if (pricePounds > MAX_TIER_PRICE_POUNDS) {
      return {
        ok: false,
        message: `${where} is over £${MAX_TIER_PRICE_POUNDS.toLocaleString("en-GB")} — check the price.`,
      };
    }

    tiers.push({
      label: row.label,
      weightGrams: kgToGrams(weightKg),
      pricePence: poundsToPence(pricePounds),
    });
  }

  return { ok: true, tiers };
}
