import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { PhotoSlot } from "@/components/ui";
import { BasketCard } from "@/components/basket-card";
import { listOpenBaskets } from "@/lib/basket-views";

export default async function HomePage() {
  const [user, openBaskets] = await Promise.all([
    getCurrentUser(),
    listOpenBaskets(),
  ]);
  const featured = openBaskets.slice(0, 3);

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
            <Link href="/baskets" className="btn-primary">
              See baskets near you
            </Link>
            {user ? (
              <Link href="/orders" className="btn-secondary">
                View your orders
              </Link>
            ) : (
              <Link href="/sign-up" className="btn-secondary">
                Get started
              </Link>
            )}
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

      {/* Open now */}
      {featured.length > 0 && (
        <section>
          <h2 className="font-display text-2xl text-ink">Open now</h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((b) => (
              <BasketCard key={b.id} basket={b} />
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section>
        <h2 className="font-display text-2xl text-ink">How it works</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Step n={1} title="Join and save your card">
            Pick the food and the size you want from your city&apos;s next
            delivery. Nothing leaves your account when you join.
          </Step>
          <Step n={2} title="The basket closes and your card is charged">
            When the basket closes, your saved card is charged for the basket
            you chose.
          </Step>
          <Step n={3} title="Delivery arrives">
            Your food arrives at the address you gave, on the delivery date
            for that basket — unless too few neighbours join, in which case
            we move it and let you know.
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
