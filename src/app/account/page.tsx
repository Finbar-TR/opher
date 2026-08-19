import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasDeliveryAddress } from "@/lib/address";
import { ProfileForm, PasswordForm } from "./account-forms";
import { resendVerificationAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const sessionUser = await requireUser();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-[38px] leading-tight text-ink">Your account</h1>
        <p className="mt-1 text-muted">{user.email}</p>
      </div>

      {!hasDeliveryAddress(user) && (
        <div className="rounded-xl border border-accent-400 bg-accent-400/15 px-4 py-3 text-sm text-accent-600">
          Add your delivery address and phone below to start claiming portions.
        </div>
      )}

      {!user.emailVerified && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-muted">Your email isn&apos;t verified yet.</span>
          <form action={resendVerificationAction}>
            <button type="submit" className="btn-secondary py-1.5">
              Resend verification email
            </button>
          </form>
        </div>
      )}

      <ProfileForm
        initial={{
          name: user.name,
          addrLine1: user.addrLine1 ?? "",
          addrLine2: user.addrLine2 ?? "",
          addrCity: user.addrCity ?? "",
          postcode: user.postcode ?? "",
          phone: user.phone ?? "",
        }}
      />
      <PasswordForm />
    </div>
  );
}
