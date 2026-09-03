import { notFound, redirect } from "next/navigation";
import { getBasketDetail } from "@/lib/basket-views";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { JoinFlow } from "./join-flow";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ utm_source?: string; utm_medium?: string; utm_campaign?: string }>;
}) {
  const { id } = await params;
  const utm = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/baskets/${id}/join`);

  const basket = await getBasketDetail(id);
  if (!basket) notFound();
  if (basket.status !== "open") redirect(`/baskets/${id}`);

  // Prefill from the saved address so a returning customer skips retyping.
  const saved = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { addrLine1: true, addrLine2: true, addrCity: true, postcode: true, phone: true },
  });

  return (
    <JoinFlow
      basket={{
        id: basket.id,
        productName: basket.productName,
        city: basket.city,
        deliveryDate: basket.deliveryDate.toISOString(),
        cutoffAt: basket.cutoffAt.toISOString(),
        cutoffDays: basket.cutoffDays,
        tiers: basket.tiers,
      }}
      savedAddress={{
        addrLine1: saved.addrLine1 ?? "",
        addrLine2: saved.addrLine2 ?? "",
        addrCity: saved.addrCity ?? "",
        postcode: saved.postcode ?? "",
        phone: saved.phone ?? "",
      }}
      utm={{ source: utm.utm_source, medium: utm.utm_medium, campaign: utm.utm_campaign }}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
    />
  );
}
