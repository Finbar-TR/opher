import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Resolves an invite code to its basket and forwards the visitor there.
// Signed-out visitors are sent to sign-in first, then bounced back.
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const basket = await prisma.basket.findUnique({
    where: { inviteCode: code.toUpperCase() },
    select: { id: true },
  });
  if (!basket) notFound();

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-in?next=/baskets/${basket.id}`);
  }
  redirect(`/baskets/${basket.id}`);
}
