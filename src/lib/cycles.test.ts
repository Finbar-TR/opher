import { describe, it, expect } from "vitest";
import { cutoffAtFor, upcomingDeliveryDates } from "./cycles";

describe("cutoffAtFor", () => {
  it("lands at 08:00 UTC three days before delivery", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T00:00:00Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });

  it("normalises the delivery time of day away", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T23:45:12Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });

  it("crosses a month boundary", () => {
    const cutoff = cutoffAtFor(new Date("2026-11-02T00:00:00Z"), 3);
    expect(cutoff.toISOString()).toBe("2026-10-30T08:00:00.000Z");
  });

  it("honours a non-default cutoff length", () => {
    const cutoff = cutoffAtFor(new Date("2026-10-17T00:00:00Z"), 5);
    expect(cutoff.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });
});

describe("upcomingDeliveryDates", () => {
  const anchor = new Date("2026-09-05T00:00:00Z"); // a Saturday

  it("returns dates on the fortnightly series after `from`", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 2);
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-09-19T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
  });

  it("includes `from` itself when it falls exactly on the series", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-19T00:00:00Z"), 1);
    expect(dates[0].toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });

  it("starts at the anchor when `from` is before it", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-08-01T00:00:00Z"), 2);
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-19T00:00:00.000Z",
    ]);
  });

  it("keeps every date on the same weekday as the anchor", () => {
    const dates = upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 6);
    for (const d of dates) expect(d.getUTCDay()).toBe(anchor.getUTCDay());
  });

  it("returns an empty list for a count of zero", () => {
    expect(upcomingDeliveryDates(anchor, 14, new Date("2026-09-06T00:00:00Z"), 0)).toEqual([]);
  });
});
