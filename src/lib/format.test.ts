import { describe, it, expect } from "vitest";
import { formatGBP, formatPricePerKg } from "./money";
import { formatWeekday, formatWeekdayTime, daysBetween } from "./dates";

describe("formatPricePerKg", () => {
  it("renders pence per kg as pounds", () => {
    expect(formatPricePerKg(475)).toBe("£4.75/kg");
  });

  it("keeps two decimal places on a round number", () => {
    expect(formatPricePerKg(400)).toBe("£4.00/kg");
  });
});

describe("formatGBP", () => {
  it("still renders plain amounts", () => {
    expect(formatGBP(2200)).toBe("£22.00");
  });
});

describe("formatWeekday", () => {
  it("names the day and date", () => {
    expect(formatWeekday(new Date("2026-12-19T00:00:00Z"))).toBe("Saturday 19 December");
  });
});

describe("formatWeekdayTime", () => {
  it("names the day, the date and the time of day", () => {
    expect(formatWeekdayTime(new Date("2026-12-15T08:00:00Z"))).toBe(
      "Tuesday 15 December at 08:00"
    );
  });

  it("reads the cutoff in UTC, not the server's timezone", () => {
    // 23:30 UTC must not roll forward or back a day for a machine set elsewhere.
    expect(formatWeekdayTime(new Date("2026-12-15T23:30:00Z"))).toBe(
      "Tuesday 15 December at 23:30"
    );
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween(new Date("2026-12-15T08:00:00Z"), new Date("2026-12-19T08:00:00Z"))).toBe(4);
  });

  it("floors a partial day", () => {
    expect(daysBetween(new Date("2026-12-15T08:00:00Z"), new Date("2026-12-19T02:00:00Z"))).toBe(3);
  });

  it("never returns a negative", () => {
    expect(daysBetween(new Date("2026-12-19T08:00:00Z"), new Date("2026-12-15T08:00:00Z"))).toBe(0);
  });
});
