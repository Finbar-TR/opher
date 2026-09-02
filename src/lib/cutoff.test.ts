import { describe, it, expect } from "vitest";
import { decideCycle } from "./cutoff";

const shortLead = { stockAt3pl: 0, leadTimeDays: 2, purchaseThresholdGrams: 100000 };
const longLead = { stockAt3pl: 0, leadTimeDays: 30, purchaseThresholdGrams: 100000 };

describe("decideCycle", () => {
  it("fails below the threshold and buys nothing", () => {
    const d = decideCycle(50000, shortLead, 3);
    expect(d).toEqual({ outcome: "failed", reason: "below_threshold", purchaseGrams: 0 });
  });

  it("fails on an empty basket", () => {
    expect(decideCycle(0, shortLead, 3).outcome).toBe("failed");
  });

  it("confirms at exactly the threshold", () => {
    const d = decideCycle(100000, shortLead, 3);
    expect(d.outcome).toBe("confirmed");
    expect(d.reason).toBe("met");
  });

  it("buys the shortfall when lead time fits the window", () => {
    expect(decideCycle(120000, shortLead, 3).purchaseGrams).toBe(120000);
  });

  it("buys only the shortfall left after stock", () => {
    const supply = { ...shortLead, stockAt3pl: 40000 };
    expect(decideCycle(120000, supply, 3).purchaseGrams).toBe(80000);
  });

  it("buys nothing when stock covers demand, even on a long lead time", () => {
    const supply = { ...longLead, stockAt3pl: 150000 };
    const d = decideCycle(120000, supply, 3);
    expect(d.outcome).toBe("confirmed");
    expect(d.purchaseGrams).toBe(0);
  });

  it("confirms when stock exactly covers demand", () => {
    const supply = { ...longLead, stockAt3pl: 120000 };
    expect(decideCycle(120000, supply, 3).outcome).toBe("confirmed");
  });

  it("fails when the lead time exceeds the window and stock is short", () => {
    const supply = { ...longLead, stockAt3pl: 40000 };
    const d = decideCycle(120000, supply, 3);
    expect(d).toEqual({ outcome: "failed", reason: "not_suppliable", purchaseGrams: 0 });
  });

  it("treats a lead time equal to the cutoff window as suppliable", () => {
    const supply = { ...shortLead, leadTimeDays: 3 };
    expect(decideCycle(120000, supply, 3).outcome).toBe("confirmed");
  });

  it("checks the threshold before supply, so an unsuppliable empty basket reads as below threshold", () => {
    expect(decideCycle(10, longLead, 3).reason).toBe("below_threshold");
  });
});
