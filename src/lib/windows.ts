import "server-only";
import { prisma } from "./prisma";
import { OPEN_WINDOWS_AHEAD } from "./constants";
import { cutoffAtFor, upcomingDeliveryDates } from "./cycles";

// Keep `OPEN_WINDOWS_AHEAD` future windows open for every active city, so a
// customer can always see the next delivery and the one after it.
//
// Idempotent: windows are unique on (cityId, deliveryDate), and an existing row
// for a date is left exactly as it is — including its status, so a window this
// run has already locked is never reopened.
export async function ensureOpenWindows(now: Date): Promise<{ created: number }> {
  const cities = await prisma.city.findMany({ where: { active: true } });
  let created = 0;

  for (const city of cities) {
    const dates = upcomingDeliveryDates(
      city.anchorDate,
      city.cadenceDays,
      now,
      OPEN_WINDOWS_AHEAD
    );

    for (const deliveryDate of dates) {
      const existing = await prisma.deliveryWindow.findUnique({
        where: { cityId_deliveryDate: { cityId: city.id, deliveryDate } },
      });
      if (existing) continue;

      const cutoffAt = cutoffAtFor(deliveryDate, city.cutoffDays);
      await prisma.deliveryWindow.create({
        data: {
          cityId: city.id,
          deliveryDate,
          cutoffAt,
          // A window whose cutoff has already passed opens locked: it can never
          // accept a join, so no order can exist past its own debit date.
          status: cutoffAt <= now ? "locked" : "open",
        },
      });
      created++;
    }
  }

  return { created };
}
