import Link from "next/link";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-sm text-center">
        <div className="card">
          <p className="text-muted">This reset link is missing its token.</p>
          <Link href="/forgot-password" className="mt-4 inline-block btn-primary">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return <ResetForm token={token} />;
}
