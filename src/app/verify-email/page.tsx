import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { consumeToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let ok = false;

  if (token) {
    const userId = await consumeToken(token, "email_verify");
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });
      ok = true;
    }
  }

  return (
    <div className="mx-auto max-w-sm text-center">
      <div className="card">
        <img src="/icon.svg" width={56} height={56} alt="" className="mx-auto" />
        <h1 className="mt-4 text-2xl font-bold text-ink">
          {ok ? "Email confirmed" : "Link invalid or expired"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {ok
            ? "Thanks — your email address is verified."
            : "This verification link is no longer valid. You can request a new one from your account."}
        </p>
        <Link href={ok ? "/catalog" : "/account"} className="mt-6 inline-block btn-primary">
          {ok ? "Browse the catalog" : "Go to account"}
        </Link>
      </div>
    </div>
  );
}
