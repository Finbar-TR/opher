import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center">
        <span className="badge bg-brand-100 text-brand-800">UK group buying</span>
        <h1 className="mx-auto mt-4 max-w-2xl text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Bulk-buy food together, split it fairly.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
          Start a basket for the food you want, invite others, and Opher merges
          part-filled baskets into whole bulk units — so everyone gets the bulk
          price without buying a whole sack alone.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href={user ? "/catalog" : "/sign-up"} className="btn-primary">
            {user ? "Browse the catalog" : "Get started"}
          </Link>
          <Link href="/catalog" className="btn-secondary">
            See what&apos;s available
          </Link>
        </div>
        <p className="mt-5 text-sm font-medium text-brand-700">
          ✓ No fill, no fee — you&apos;re only charged when a basket completes.
        </p>
      </section>

      {/* The merge idea, illustrated */}
      <section className="card mx-auto max-w-2xl">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-muted">
          How the merge works
        </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-center">
          <FillCard label="Aisha's basket" filled={2} total={5} />
          <span className="text-2xl font-bold text-muted">+</span>
          <FillCard label="Ben's basket" filled={3} total={5} />
          <span className="text-2xl font-bold text-muted">=</span>
          <FillCard label="One 25kg sack" filled={5} total={5} highlight />
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          Two part-filled baskets for the same item combine into one whole bulk
          unit. Opher buys the sack, then splits it back to each member.
        </p>
      </section>

      {/* Steps */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Step n={1} title="Create or join a basket">
          Pick a commodity and choose how many portions your group wants.
        </Step>
        <Step n={2} title="Fill & commit">
          Invite others to claim portions. Commit when you&apos;re ready to buy.
        </Step>
        <Step n={3} title="Pay your share & track">
          Pay only for your portions, then follow delivery to your door.
        </Step>
      </section>
    </div>
  );
}

function FillCard({
  label,
  filled,
  total,
  highlight,
}: {
  label: string;
  filled: number;
  total: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`w-32 rounded-xl border p-3 ${
        highlight ? "border-brand-500 bg-brand-50" : "border-line bg-surface"
      }`}
    >
      <div className="flex justify-center gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-6 w-3 rounded-sm ${
              i < filled ? "bg-brand-500" : "bg-line"
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-sm font-semibold text-ink">
        {filled}/{total}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">
        {n}
      </div>
      <h3 className="mt-3 font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}
