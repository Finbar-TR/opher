"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

// Fixed bottom navigation on phones only (hidden at sm+). Active tab in tomato.
export function MobileTabBar({ user }: { user: SessionUser | null }) {
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "Home" },
    { href: "/baskets", label: "Baskets" },
    ...(user ? [{ href: "/orders", label: "Orders" }] : []),
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur sm:hidden">
      <ul className="mx-auto flex max-w-5xl">
        {tabs.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold uppercase tracking-wider ${
                  active ? "text-tomato" : "text-soft"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-tomato" : "bg-transparent"
                  }`}
                />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
