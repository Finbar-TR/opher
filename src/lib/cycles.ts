// Pure date arithmetic for the city delivery schedule. No database access —
// the DB-facing counterpart is `cycle-run.ts`.

import { CUTOFF_HOUR_UTC } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;

// Midnight UTC on the same calendar day.
function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// The moment a window closes to new joins AND its cards are charged: 08:00 UTC,
// `cutoffDays` before the delivery date. Fixed at an hour rather than a rolling
// 72 hours so a single daily cron can own it.
export function cutoffAtFor(deliveryDate: Date, cutoffDays: number): Date {
  const d = startOfUtcDay(deliveryDate);
  d.setUTCDate(d.getUTCDate() - cutoffDays);
  d.setUTCHours(CUTOFF_HOUR_UTC, 0, 0, 0);
  return d;
}

// The next `count` delivery dates on the series `anchorDate + n * cadenceDays`
// that fall on or after `from`. All normalised to midnight UTC, so every date
// keeps the anchor's weekday.
export function upcomingDeliveryDates(
  anchorDate: Date,
  cadenceDays: number,
  from: Date,
  count: number
): Date[] {
  if (count <= 0) return [];

  const anchor = startOfUtcDay(anchorDate);
  const start = startOfUtcDay(from);
  const cadenceMs = cadenceDays * DAY_MS;

  // How many whole cadences past the anchor `start` sits. Negative when `from`
  // precedes the anchor, in which case the series begins at the anchor itself.
  const elapsed = start.getTime() - anchor.getTime();
  const firstIndex = Math.max(0, Math.ceil(elapsed / cadenceMs));

  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(anchor.getTime() + (firstIndex + i) * cadenceMs));
  }
  return dates;
}
