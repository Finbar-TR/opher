import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "./logo";
import { MobileTabBar } from "./mobile-tabbar";

function NavLink({
  href,
  dark,
  children,
}: {
  href: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-2 font-semibold transition-colors ${
        dark
          ? "text-[#dcc3ab] hover:text-[#fffaf3]"
          : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

export async function Nav() {
  const user = await getCurrentUser();
  const operator = user?.role === "operator";
  const dark = operator;

  return (
    <>
      <header
        className={`sticky top-0 z-30 backdrop-blur ${
          dark ? "bg-ink" : "border-b border-line bg-bg/90"
        }`}
      >
        <nav className="mx-auto flex max-w-5xl items-center gap-4 px-5 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Logo dark={dark} />
            {operator && (
              <span className="badge bg-[#5c4432] text-[#e6d3c0]">Operator</span>
            )}
          </Link>

          {/* Desktop */}
          <div className="ml-auto hidden items-center gap-1 text-sm sm:flex">
            <NavLink href="/baskets" dark={dark}>
              Baskets
            </NavLink>
            {user && (
              <NavLink href="/orders" dark={dark}>
                Orders
              </NavLink>
            )}
            {operator && (
              <NavLink href="/operator" dark={dark}>
                Operator
              </NavLink>
            )}

            {user ? (
              <form action={signOutAction} className="ml-2 flex items-center gap-3">
                <Link
                  href="/account"
                  className={`font-semibold hover:underline ${
                    dark ? "text-[#dcc3ab]" : "text-muted"
                  }`}
                >
                  {user.name}
                </Link>
                <button type="submit" className="btn-secondary py-2">
                  Sign out
                </button>
              </form>
            ) : (
              <div className="ml-2 flex items-center gap-2">
                <Link href="/sign-in" className="btn-secondary py-2">
                  Sign in
                </Link>
                <Link href="/sign-up" className="btn-primary py-2">
                  Sign up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile — top-right */}
          <div className="ml-auto sm:hidden">
            {user ? (
              <Link
                href="/account"
                aria-label="Account"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-tomato text-sm font-bold text-[#fffaf3]"
              >
                {user.name.charAt(0).toUpperCase()}
              </Link>
            ) : (
              <Link href="/sign-in" className="btn-primary py-1.5">
                Sign in
              </Link>
            )}
          </div>
        </nav>
      </header>
      <MobileTabBar user={user} />
    </>
  );
}
