import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP, savings } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { requestBaseUrl } from "@/lib/base-url";
import { BasketStatusBadge, ProgressBar, NoFillNoFee } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { ClaimForm } from "./claim-form";
import {
  commitBasketAction,
  leaveBasketAction,
  removeMemberAction,
  uncommitBasketAction,
  cancelBasketAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function BasketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const basket = await prisma.basket.findUnique({
    where: { id },
    include: {
      commodity: true,
      organiser: true,
      claims: { include: { user: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!basket) notFound();

  const filled = basket.claims.reduce((s, c) => s + c.portions, 0);
  const remaining = basket.targetPortions - filled;
  const myClaim = basket.claims.find((c) => c.userId === user.id);
  const isOrganiser = basket.organiserId === user.id;
  const price = basket.commodity.pricePerPortion;
  const totalOwed = filled * price;
  const isOpen = basket.status === "open";

  const appUrl = await requestBaseUrl();
  const inviteUrl = `${appUrl}/join/${basket.inviteCode}`;
  const s = savings(price, basket.commodity.shopPricePerPortion);
  const basketSavings = s ? s.perPortion * filled : 0;
  const deliveryFee = basket.commodity.deliveryFee;
  const shareText = `Join our group buy for ${basket.commodity.name} on Opher${
    s ? ` — save ${formatGBP(s.perPortion)}/portion vs shop` : ""
  } — ${inviteUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/baskets" className="text-sm font-semibold text-soft hover:underline">
        ← My baskets
      </Link>

      {/* Roast hero */}
      <div className="grid gap-6 rounded-3xl p-7 sm:grid-cols-[1.2fr_300px]" style={{ background: "#7c2d12" }}>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <BasketStatusBadge status={basket.status} />
            {(basket.status === "open" || basket.status === "committed") &&
              basket.expiresAt && (
                <span className="text-xs text-[#e0a86a]">
                  Closes {formatDate(basket.expiresAt)} if it hasn&apos;t merged
                </span>
              )}
          </div>
          <h1 className="mt-3 font-display text-[40px] leading-tight text-[#fffaf3] sm:text-[46px]">
            {basket.title}
          </h1>
          <p className="mt-1 text-sm text-[#e0a86a]">
            <Link href={`/catalog/${basket.commodityId}`} className="hover:underline">
              {basket.commodity.name}
            </Link>{" "}
            · {basket.commodity.bulkUnitLabel} · {formatGBP(price)} / portion
          </p>
        </div>
        <div className="flex flex-col justify-center">
          <div className="flex items-baseline justify-between text-[#fffaf3]">
            <span className="text-sm font-bold">
              {filled} of {basket.targetPortions} portions
            </span>
            <span className="text-sm font-bold">{formatGBP(totalOwed)} pledged</span>
          </div>
          <div className="mt-2">
            <ProgressBar filled={filled} total={basket.targetPortions} dark className="h-4" />
          </div>
          {isOpen && remaining > 0 && (
            <p className="mt-3 text-[15px] font-extrabold text-[#fffaf3]">
              {remaining === 1
                ? "Just 1 portion left to complete this basket!"
                : `${remaining} portions still available.`}
            </p>
          )}
          <p className="mt-1 text-sm text-[#e0a86a]">
            Delivery about {basket.commodity.deliveryLeadDays} days after it completes.
          </p>
          {basketSavings > 0 && (
            <p className="mt-1 text-sm font-bold" style={{ color: "#f0844c" }}>
              Saves {formatGBP(basketSavings)} vs shop so far.
            </p>
          )}
        </div>
      </div>

      {basket.orderId && (
        <div className="rounded-2xl border border-line bg-saffron px-4 py-3 text-sm text-saffron-ink">
          This basket has been merged into an order.{" "}
          <Link href={`/orders/${basket.orderId}`} className="font-bold underline">
            View order &amp; delivery →
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* Ledger */}
        <div className="card">
          <h2 className="eyebrow">Members &amp; shares</h2>
          <table className="mt-3 w-full text-left text-sm">
            <tbody className="divide-y divide-line-soft">
              {basket.claims.map((c) => (
                <tr key={c.id}>
                  <td className="py-3.5 font-semibold text-ink">
                    {c.user.name}
                    {c.userId === basket.organiserId && (
                      <span className="ml-2 text-[11px] font-bold text-tomato">ORGANISER</span>
                    )}
                    {c.userId === user.id && (
                      <span className="ml-2 text-xs text-soft">(you)</span>
                    )}
                  </td>
                  <td className="py-3.5 text-soft">{c.portions}</td>
                  <td className="py-3.5 text-right font-semibold text-ink">
                    {formatGBP(c.portions * price)}
                  </td>
                  {isOrganiser && isOpen && (
                    <td className="py-3.5 pl-3 text-right">
                      {c.userId !== basket.organiserId && (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="basketId" value={basket.id} />
                          <input type="hidden" name="userId" value={c.userId} />
                          <button type="submit" className="text-xs font-bold text-tomato-press hover:underline">
                            Remove
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {isOpen && remaining > 0 && (
                <tr className="text-soft">
                  <td className="py-3.5 italic">{remaining} portion(s) unclaimed</td>
                  <td className="py-3.5">{remaining}</td>
                  <td className="py-3.5 text-right">{formatGBP(remaining * price)}</td>
                  {isOrganiser && <td />}
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line">
                <td className="pt-3 font-bold text-ink">Total</td>
                <td className="pt-3 font-bold text-ink">{filled}</td>
                <td className="pt-3 text-right font-bold text-tomato">{formatGBP(totalOwed)}</td>
                {isOrganiser && isOpen && <td />}
              </tr>
            </tfoot>
          </table>

          {isOpen && (
            <div className="mt-5 border-t border-line-soft pt-5">
              <ClaimForm
                basketId={basket.id}
                remaining={remaining}
                currentPortions={myClaim?.portions ?? 0}
                pricePerPortion={price}
              />
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {isOpen && (
            <div className="card">
              <p className="label">Invite your group</p>
              <div className="flex items-center justify-between gap-2 rounded-[14px] bg-saffron px-4 py-3">
                <code className="font-mono text-lg font-semibold tracking-[0.12em] text-saffron-ink">
                  {basket.inviteCode}
                </code>
                <CopyButton value={inviteUrl} label="Copy link" />
              </div>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn mt-3 w-full text-[#fffaf3]"
                style={{ background: "#25a35a" }}
              >
                Share on WhatsApp
              </a>
              <p className="mt-2 text-xs text-soft">
                {deliveryFee > 0
                  ? `Delivery is ${formatGBP(deliveryFee)} per person — free for you as the organiser.`
                  : "Anyone with the link can join and claim portions."}
              </p>
            </div>
          )}

          {isOpen && (
            <div className="card space-y-4">
              <NoFillNoFee />
              {isOrganiser && (
                <>
                  <form action={commitBasketAction}>
                    <input type="hidden" name="basketId" value={basket.id} />
                    <button type="submit" className="btn-primary w-full" disabled={filled < 1}>
                      Commit basket to buy
                    </button>
                  </form>
                  <p className="text-xs text-soft">
                    Committing locks the basket and looks for complementary baskets to
                    complete a whole {basket.commodity.bulkUnitLabel}.
                  </p>
                  <form action={cancelBasketAction}>
                    <input type="hidden" name="basketId" value={basket.id} />
                    <button type="submit" className="btn-danger w-full">
                      Cancel basket
                    </button>
                  </form>
                </>
              )}
              {!isOrganiser && myClaim && (
                <form action={leaveBasketAction}>
                  <input type="hidden" name="basketId" value={basket.id} />
                  <button type="submit" className="btn-danger w-full">
                    Leave basket
                  </button>
                </form>
              )}
            </div>
          )}

          {basket.status === "committed" && !basket.orderId && (
            <div className="card space-y-4">
              <p className="text-sm text-muted">
                Committed — waiting to merge with other baskets into a whole{" "}
                {basket.commodity.bulkUnitLabel}.
              </p>
              {isOrganiser && (
                <div className="flex flex-wrap gap-3">
                  <form action={uncommitBasketAction}>
                    <input type="hidden" name="basketId" value={basket.id} />
                    <button type="submit" className="btn-secondary">
                      Re-open basket
                    </button>
                  </form>
                  <form action={cancelBasketAction}>
                    <input type="hidden" name="basketId" value={basket.id} />
                    <button type="submit" className="btn-danger">
                      Cancel basket
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
