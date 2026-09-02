"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/", label: "Home" }];

// Fixed bottom navigation on phones only (hidden at sm+). Active tab in tomato.
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur sm:hidden">
      <ul className="mx-auto flex max-w-5xl">
        {TABS.map((t) => {
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
