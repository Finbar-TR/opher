import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { PhotoSlot } from "@/components/ui";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="grid items-center gap-9 md:grid-cols-2">
        <div>
          <span className="badge bg-saffron text-saffron-ink">UK group buying</span>
          <h1 className="mt-4 font-display text-[44px] leading-[1.02] text-ink sm:text-[62px]">
            Split the sack, not the <em className="text-tomato">savings</em>.
          </h1>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted">
            Start a basket for the food you want, invite others, and Opher merges
            part-filled baskets into whole bulk units — so everyone gets the bulk
            price without buying a whole sack alone.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={user ? "/catalog" : "/sign-up"} className="btn-primary">
              Get started
            </Link>
            <Link href="/catalog" className="btn-secondary">
              See what&apos;s available
            </Link>
          </div>
          <p className="mt-5 text-sm font-bold text-saffron-ink">
            ✓ No fill, no fee — you&apos;re only charged when a basket completes.
          </p>
        </div>

        <div className="relative">
          <PhotoSlot
            caption="Market stall — sacks of rice, plantain, fresh peppers"
            className="h-[300px] w-full rounded-3xl sm:h-[380px]"
          />
          <div
            className="absolute -bottom-5 -left-5 rounded-2xl border border-line bg-surface p-4"
            style={{ boxShadow: "0 12px 30px rgba(122,60,20,0.12)" }}
          >
            <p className="eyebrow">Elm Street neighbours</p>
            <div className="mt-2 flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="h-[26px] w-3.5 rounded-[3px]"
                  style={{ background: i < 2 ? "#d6432c" : "#eeddcb" }}
                />
              ))}
            </div>
            <p className="mt-2 text-sm font-bold text-ink">2/5 portions</p>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="grid gap-5 sm:grid-cols-3">
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

      {/* Merge explainer */}
      <section
        className="rounded-3xl p-8 text-[#fffaf3] sm:p-9"
        style={{ background: "#7c2d12" }}
      >
        <h2 className="text-center font-display text-2xl">How the merge works</h2>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-5">
          <MergeGroup label="Aisha's basket" filled={2} />
          <span className="font-display text-3xl text-[#e0a86a]">+</span>
          <MergeGroup label="Ben's basket" filled={3} />
          <span className="font-display text-3xl text-[#e0a86a]">=</span>
          <MergeGroup label="One 25kg sack" filled={5} complete />
        </div>
        <p className="mx-auto mt-7 max-w-xl text-center text-sm text-[#e0a86a]">
          Two part-filled baskets for the same item combine into one whole bulk
          unit. Opher buys the sack, then splits it back to each member.
        </p>
      </section>
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
      <p className="font-display text-3xl text-tomato">{n}</p>
      <h3 className="mt-2 text-[17px] font-bold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}

function MergeGroup({
  label,
  filled,
  complete = false,
}: {
  label: string;
  filled: number;
  complete?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="flex justify-center gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-6 w-3 rounded-[2px]"
            style={{
              background: complete
                ? "#fdecc8"
                : i < filled
                  ? "#f0844c"
                  : "#9a5330",
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs font-semibold text-[#e0a86a]">{label}</p>
    </div>
  );
}
