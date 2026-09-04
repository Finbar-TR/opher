import { describe, it, expect } from "vitest";
import { formatGBP, poundsToPence } from "./money";

describe("money formatting", () => {
  it("formats pence as GBP", () => {
    expect(formatGBP(1234)).toBe("£12.34");
  });
  it("converts pounds to integer pence", () => {
    expect(poundsToPence(12.34)).toBe(1234);
  });
});
