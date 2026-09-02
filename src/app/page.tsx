import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { PhotoSlot } from "@/components/ui";

// Deliberately minimal. The full landing page is designed in the next plan;
// until then this page's only job is to be TRUE. Every order in a window is
// charged at that window's cutoff — there is no minimum demand and no
// conditional delivery — so any copy implying a customer might not be charged,
// and every trace of the deleted portions/merge model, must not ship.

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="grid items-center gap-9 md:grid-cols-2">
        <div>
          <span className="badge bg-saffron text-saffron-ink">UK group buying</span>
          <h1 className="mt-4 font-display text-[44px] leading-[1.02] text-ink sm:text-[62px]">
            Buy food at the <em className="text-tomato">bulk price</em>, together.
          </h1>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted">
            Opher runs a delivery in your city every fortnight. Join a basket
            before it closes and you get the bulk price on staples you&apos;d
            otherwise pay corner-shop money for.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={user ? "/" : "/sign-up"} className="btn-primary">
              Get started
            </Link>
            <Link href="/" className="btn-secondary">
              See what&apos;s available
            </Link>
          </div>
          <p className="mt-5 text-sm font-bold text-saffron-ink">
            ✓ Cancel free any time before your basket closes.
          </p>
        </div>

        <div className="relative">
          <PhotoSlot
            caption="Market stall — sacks of rice, plantain, fresh peppers"
            className="h-[300px] w-full rounded-3xl sm:h-[380px]"
          />
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="font-display text-2xl text-ink">How it works</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Step n={1} title="Join a basket in your city">
            Pick the food and the size you want from your city&apos;s next
            delivery.
          </Step>
          <Step n={2} title="Your card is saved, not charged">
            Nothing leaves your account when you join. Cancel free until your
            basket closes.
          </Step>
          <Step n={3} title="It closes three days before delivery">
            At that moment joining stops and your saved card is charged for the
            basket you chose.
          </Step>
          <Step n={4} title="Delivery">
            Your food arrives at the address you gave, on the delivery date for
            that cycle.
          </Step>
        </div>
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
