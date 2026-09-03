import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { listUpcomingCycles, type CycleRow } from "@/lib/admin-views";
import { OperatorNav } from "@/components/operator-nav";
import { formatKg } from "@/lib/weight";
import { formatWeekday, formatWeekdayTime } from "@/lib/dates";

export const dynamic = "force-dynamic";

// One line per state, each of them true. `text-saffron-ink` marks the two the
// operator still has to act on; `text-muted` marks the one that is finished.
// `overdue` is a fault — nothing was charged — so it gets the loudest treatment
// on the page rather than the quietest.
function cutoffLine(row: CycleRow): { text: string; className: string } {
  const hours = Math.abs(row.hoursToCutoff);
  switch (row.state) {
    case "charged":
      return { text: "Charged — delivery committed", className: "text-muted" };
    case "overdue":
      return {
        text: "Cutoff passed but not charged — check the cron",
        className: "text-tomato-press",
      };
    case "closing":
      return { text: "Under an hour to order", className: "text-saffron-ink" };
    case "open":
      return {
        text: `${hours} ${hours === 1 ? "hour" : "hours"} to order`,
        className: "text-saffron-ink",
      };
  }
}

export default async function CyclesPage() {
  await requireOperator();
  const rows = await listUpcomingCycles();

  return (
    <div className="mx-auto max-w-4xl">
      <OperatorNav current="cycles" />
      <h1 className="font-display text-[38px] leading-tight text-ink">What to buy</h1>
      <p className="mt-1 text-muted">
        Every delivery with joiners, soonest first. Order supply before the
        cutoff — after it, cards are charged and the delivery is committed.
      </p>

      {rows.length === 0 ? (
        <p className="card mt-6 text-muted">Nobody has joined an upcoming delivery yet.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((r) => {
            const cutoff = cutoffLine(r);
            return (
              <div key={`${r.windowId}-${r.basketId}`} className="card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-xl text-ink">
                      {r.productName} — {r.city}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Delivers {formatWeekday(r.deliveryDate)} · closes {formatWeekdayTime(r.cutoffAt)}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {r.joiners === 1 ? "1 joiner" : `${r.joiners} joiners`} · {formatKg(r.grams)} ordered
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-display text-2xl text-ink">
                      {r.bulkUnitsNeeded} × {r.skuLabel}
                    </p>
                    <p className="mt-1 text-sm text-muted">to cover {formatKg(r.grams)}</p>
                    <p className={`mt-2 text-sm font-semibold ${cutoff.className}`}>
                      {cutoff.text}
                    </p>
                    <Link
                      href={`/operator/cycles/${r.windowId}`}
                      className="mt-2 inline-block font-medium text-brand-700 hover:underline"
                    >
                      See orders
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
