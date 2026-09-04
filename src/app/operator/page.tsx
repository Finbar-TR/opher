import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { OperatorNav } from "@/components/operator-nav";

export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/operator/cycles",
    title: "What to buy",
    body: "Every delivery with joiners, how much to order, and how long is left before the cards are charged.",
  },
  {
    href: "/operator/baskets",
    title: "Baskets",
    body: "Open a food in a city, set its sizes, pause it when supply is tight.",
  },
  {
    href: "/operator/catalogue",
    title: "Catalogue",
    body: "The foods you sell and the bulk unit you buy each one in.",
  },
];

export default async function OperatorHome() {
  await requireOperator();

  return (
    <div className="mx-auto max-w-3xl">
      <OperatorNav current="home" />
      <h1 className="font-display text-[38px] leading-tight text-ink sm:text-[46px]">
        Today in the kitchen
      </h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card block transition hover:border-line-strong">
            <p className="font-display text-xl text-ink">{c.title}</p>
            <p className="mt-2 text-sm text-muted">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
