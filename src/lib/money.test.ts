import { describe, it, expect } from "vitest";
import { savings, formatGBP, poundsToPence } from "./money";

describe("savings", () => {
  it("computes per-portion saving and percent vs shop price", () => {
    expect(savings(1000, 1500)).toEqual({ perPortion: 500, percent: 33 });
  });
  it("returns null when there is no shop price", () => {
    expect(savings(1000, null)).toBeNull();
    expect(savings(1000, undefined)).toBeNull();
  });
  it("returns null when the shop price isn't higher", () => {
    expect(savings(1000, 900)).toBeNull();
    expect(savings(1000, 1000)).toBeNull();
  });
});

describe("money formatting", () => {
  it("formats pence as GBP", () => {
    expect(formatGBP(1234)).toBe("£12.34");
  });
  it("converts pounds to integer pence", () => {
    expect(poundsToPence(12.34)).toBe(1234);
  });
});
