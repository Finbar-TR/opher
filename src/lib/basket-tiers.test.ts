import { describe, it, expect } from "vitest";
import { parseTiers, MAX_TIER_WEIGHT_KG, MAX_TIER_PRICE_POUNDS } from "./basket-tiers";
import { kgToGrams } from "./weight";

function ok(result: ReturnType<typeof parseTiers>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
  return result.tiers;
}

function err(result: ReturnType<typeof parseTiers>) {
  if (result.ok) throw new Error("expected a failure, got tiers");
  return result.message;
}

describe("kgToGrams", () => {
  it("converts to integer grams", () => {
    expect(kgToGrams(2.5)).toBe(2500);
    expect(kgToGrams(0.1)).toBe(100);
  });

  it("rounds rather than truncating", () => {
    expect(kgToGrams(2.3456)).toBe(2346);
  });
});

describe("parseTiers", () => {
  it("zips the three parallel arrays into tiers, in order", () => {
    const tiers = ok(
      parseTiers(
        ["Small", "Medium", "Large"],
        ["2", "5", "10"],
        ["9.50", "22", "40"]
      )
    );
    expect(tiers).toEqual([
      { label: "Small", weightGrams: 2000, pricePence: 950 },
      { label: "Medium", weightGrams: 5000, pricePence: 2200 },
      { label: "Large", weightGrams: 10000, pricePence: 4000 },
    ]);
  });

  it("drops a row only when every field is blank", () => {
    // The form renders four rows up front; two untouched ones must vanish.
    const tiers = ok(
      parseTiers(
        ["Small", "Large", "", ""],
        ["2", "10", "", ""],
        ["9.50", "40", "", ""]
      )
    );
    expect(tiers).toHaveLength(2);
    expect(tiers.map((t) => t.label)).toEqual(["Small", "Large"]);
  });

  it("ignores whitespace-only rows and trims the labels it keeps", () => {
    const tiers = ok(
      parseTiers([" Small ", "Large", "  "], ["2", "10", " "], ["9.50", "40", ""])
    );
    expect(tiers.map((t) => t.label)).toEqual(["Small", "Large"]);
  });

  it("raises a half-filled row instead of silently dropping it", () => {
    // The bug this retires: a blank label used to drop the whole row, so an
    // operator who typed a weight and a price but no name lost the size and
    // was told nothing.
    const message = err(
      parseTiers(["Small", "", "Large"], ["2", "5", "10"], ["9.50", "22", "40"])
    );
    expect(message).toContain("Size 2");
    expect(message).toContain("name");
  });

  it("raises a row missing only its price", () => {
    const message = err(
      parseTiers(["Small", "Large"], ["2", "10"], ["9.50", ""])
    );
    expect(message).toContain("Large");
  });

  it("refuses fewer than two sizes", () => {
    const message = err(parseTiers(["Small", ""], ["2", ""], ["9.50", ""]));
    expect(message).toBe("A basket needs between 2 and 4 sizes.");
  });

  it("refuses no sizes at all", () => {
    expect(err(parseTiers([], [], []))).toBe(
      "A basket needs between 2 and 4 sizes."
    );
  });

  it("refuses more than four sizes", () => {
    const labels = ["A", "B", "C", "D", "E"];
    const message = err(
      parseTiers(labels, ["1", "2", "3", "4", "5"], ["1", "2", "3", "4", "5"])
    );
    expect(message).toBe("A basket needs between 2 and 4 sizes.");
  });

  it("converts kg to grams and pounds to pence, rounding", () => {
    const tiers = ok(
      parseTiers(["Odd", "Odder"], ["2.3456", "0.1"], ["9.99", "0.125"])
    );
    expect(tiers[0].weightGrams).toBe(2346);
    expect(tiers[0].pricePence).toBe(999);
    expect(tiers[1].weightGrams).toBe(100);
    // Rounds a half-penny up rather than truncating it away.
    expect(tiers[1].pricePence).toBe(13);
  });

  it("refuses a zero or negative weight", () => {
    expect(err(parseTiers(["A", "B"], ["0", "2"], ["10", "20"]))).toContain(
      "weight"
    );
    expect(err(parseTiers(["A", "B"], ["-1", "2"], ["10", "20"]))).toContain(
      "weight"
    );
  });

  it("refuses a non-numeric weight or price", () => {
    expect(err(parseTiers(["A", "B"], ["heavy", "2"], ["10", "20"]))).toContain(
      "weight"
    );
    expect(err(parseTiers(["A", "B"], ["1", "2"], ["free", "20"]))).toContain(
      "price"
    );
  });

  it("bounds the weight so a fat finger is a sentence, not a Prisma error", () => {
    const message = err(
      parseTiers(["A", "B"], [`${MAX_TIER_WEIGHT_KG + 1}`, "2"], ["10", "20"])
    );
    expect(message).toContain("over 1000 kg");
  });

  it("bounds the price the same way", () => {
    const message = err(
      parseTiers(["A", "B"], ["1", "2"], [`${MAX_TIER_PRICE_POUNDS + 1}`, "20"])
    );
    expect(message).toContain("check the price");
  });

  it("accepts the bounds themselves", () => {
    const tiers = ok(
      parseTiers(
        ["A", "B"],
        [`${MAX_TIER_WEIGHT_KG}`, "2"],
        [`${MAX_TIER_PRICE_POUNDS}`, "20"]
      )
    );
    expect(tiers[0].weightGrams).toBe(MAX_TIER_WEIGHT_KG * 1000);
    expect(tiers[0].pricePence).toBe(MAX_TIER_PRICE_POUNDS * 100);
  });
});
