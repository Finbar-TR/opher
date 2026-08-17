import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { signOutAction } from "@/app/(auth)/actions";

export async function Nav() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-ink">
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
          <span className="text-lg">Opher</span>
        </Link>

        <div className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/catalog" className="rounded-md px-3 py-2 font-medium text-ink hover:bg-brand-50">
            Catalog
          </Link>
          {user && (
            <Link href="/baskets" className="rounded-md px-3 py-2 font-medium text-ink hover:bg-brand-50">
              My baskets
            </Link>
          )}
          {user && (
            <Link href="/orders" className="rounded-md px-3 py-2 font-medium text-ink hover:bg-brand-50">
              Orders
            </Link>
          )}
          {user?.role === "operator" && (
            <Link href="/operator" className="rounded-md px-3 py-2 font-medium text-accent-600 hover:bg-brand-50">
              Operator
            </Link>
          )}

          {user ? (
            <form action={signOutAction} className="ml-2 flex items-center gap-3">
              <Link
                href="/account"
                className="hidden font-medium text-ink hover:underline sm:inline"
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
      </nav>
    </header>
  );
}
