import Link from "next/link";

const LINKS = [
  { key: "home", href: "/operator", label: "Overview" },
  { key: "cycles", href: "/operator/cycles", label: "What to buy" },
  { key: "baskets", href: "/operator/baskets", label: "Baskets" },
  { key: "catalogue", href: "/operator/catalogue", label: "Catalogue" },
] as const;

// The union, not `string`: a typo in `current` should be a type error rather
// than a nav bar that quietly highlights nothing.
export type OperatorNavKey = (typeof LINKS)[number]["key"];

export function OperatorNav({ current }: { current: OperatorNavKey }) {
  return (
    <nav className="mb-8 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          className={`badge ${current === l.key ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
