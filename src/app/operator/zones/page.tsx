import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ZoneForm } from "./zone-form";
import { toggleZoneActiveAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ZonesPage() {
  await requireOperator();
  const [zones, waitlist] = await Promise.all([
    prisma.deliveryZone.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.waitlist.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/operator" className="text-sm text-muted hover:underline">
          ← Operator
        </Link>
        <h1 className="mt-2 font-display text-[38px] leading-tight text-ink">Delivery zones</h1>
        <p className="mt-1 text-muted">
          Launch one cluster at a time. With no active zones, baskets are open to all
          areas; once you add one, only people inside an active zone can create baskets.
        </p>
      </div>

      {zones.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Zone</th>
                <th className="px-4 py-3 font-medium">Outward codes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {zones.map((z) => (
                <tr key={z.id}>
                  <td className="px-4 py-3 font-medium text-ink">{z.name}</td>
                  <td className="px-4 py-3 text-muted">{z.outwardCodes}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`badge ${
                        z.active ? "bg-brand-100 text-brand-800" : "bg-line text-muted"
                      }`}
                    >
                      {z.active ? "Live" : "Paused"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggleZoneActiveAction}>
                      <input type="hidden" name="id" value={z.id} />
                      <button type="submit" className="font-medium text-brand-700 hover:underline">
                        {z.active ? "Pause" : "Go live"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ZoneForm />

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Waitlist ({waitlist.length}) — demand outside your live zones
        </h2>
        {waitlist.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No waitlist signups yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {waitlist.map((w) => (
              <li key={w.id} className="flex justify-between text-muted">
                <span className="text-ink">{w.postcode || "—"}</span>
                <span>{w.email}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
