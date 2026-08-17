import { describe, it, expect } from "vitest";
import { mergeBaskets } from "./merge";

describe("mergeBaskets", () => {
  it("merges two complementary baskets into one whole unit (2/5 + 3/5 = 5/5)", () => {
    const result = mergeBaskets(
      [
        { basketId: "a", portions: 2 },
        { basketId: "b", portions: 3 },
      ],
      5
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].portions).toBe(5);
    expect(result.groups[0].basketIds.sort()).toEqual(["a", "b"]);
    expect(result.leftover).toHaveLength(0);
  });

  it("treats a basket that already fills a whole unit as its own order", () => {
    const result = mergeBaskets([{ basketId: "a", portions: 5 }], 5);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].basketIds).toEqual(["a"]);
    expect(result.leftover).toHaveLength(0);
  });

  it("leaves a basket open when no complement completes a whole unit", () => {
    const result = mergeBaskets(
      [
        { basketId: "a", portions: 2 },
        { basketId: "b", portions: 2 },
      ],
      5
    );
    expect(result.groups).toHaveLength(0);
    expect(result.leftover.map((l) => l.basketId).sort()).toEqual(["a", "b"]);
  });

  it("forms multiple whole units and keeps the remainder as leftover", () => {
    // 4 + 1 = 5, 3 + 2 = 5, and a lone 2 remains.
    const result = mergeBaskets(
      [
        { basketId: "a", portions: 4 },
        { basketId: "b", portions: 1 },
        { basketId: "c", portions: 3 },
        { basketId: "d", portions: 2 },
        { basketId: "e", portions: 2 },
      ],
      5
    );
    expect(result.groups).toHaveLength(2);
    for (const g of result.groups) expect(g.portions).toBe(5);
    expect(result.leftover).toHaveLength(1);
  });

  it("combines three baskets into one unit (1 + 1 + 3 = 5)", () => {
    const result = mergeBaskets(
      [
        { basketId: "a", portions: 1 },
        { basketId: "b", portions: 1 },
        { basketId: "c", portions: 3 },
      ],
      5
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].basketIds.sort()).toEqual(["a", "b", "c"]);
    expect(result.leftover).toHaveLength(0);
  });

  it("drops empty/oversized baskets into leftover", () => {
    const result = mergeBaskets(
      [
        { basketId: "a", portions: 0 },
        { basketId: "b", portions: 7 },
      ],
      5
    );
    expect(result.groups).toHaveLength(0);
    expect(result.leftover.map((l) => l.basketId).sort()).toEqual(["a", "b"]);
  });

  it("returns everything as leftover for a non-positive unit size", () => {
    const result = mergeBaskets([{ basketId: "a", portions: 2 }], 0);
    expect(result.groups).toHaveLength(0);
    expect(result.leftover).toHaveLength(1);
  });
});
