import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatGBP, savings } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { requestBaseUrl } from "@/lib/base-url";
import {
  FillMeter,
  BasketStatusBadge,
  SavingsBadge,
  NoFillNoFee,
} from "@/components/ui";
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

  const appUrl = await requestBaseUrl();
  const inviteUrl = `${appUrl}/join/${basket.inviteCode}`;
  const isOpen = basket.status === "open";

  const s = savings(price, basket.commodity.shopPricePerPortion);
  const basketSavings = s ? s.perPortion * filled : 0;
  const deliveryFee = basket.commodity.deliveryFee;
  const shareText = `Join our group buy for ${basket.commodity.name} on Opher${
    s ? ` — save ${formatGBP(s.perPortion)}/portion vs shop` : ""
  } — ${inviteUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/baskets" className="text-sm text-muted hover:underline">
          ← My baskets
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-ink">{basket.title}</h1>
          <BasketStatusBadge status={basket.status} />
        </div>
        <p className="mt-1 text-muted">
          <Link
            href={`/catalog/${basket.commodityId}`}
            className="text-brand-700 hover:underline"
          >
            {basket.commodity.name}
          </Link>{" "}
          · {basket.commodity.bulkUnitLabel} · {formatGBP(price)} / portion
        </p>
        <div className="mt-2">
          <SavingsBadge
            pricePerPortion={price}
            shopPricePerPortion={basket.commodity.shopPricePerPortion}
          />
        </div>
      </div>

      {basket.orderId && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          This basket has been merged into an order.{" "}
          <Link href={`/orders/${basket.orderId}`} className="font-semibold underline">
            View order & delivery →
          </Link>
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Progress
        </h2>
        <div className="mt-3">
          <FillMeter filled={filled} total={basket.targetPortions} />
        </div>
        {isOpen && remaining > 0 && (
          <p
            className={`mt-3 text-sm ${
              remaining === 1 ? "font-semibold text-accent-600" : "text-muted"
            }`}
          >
            {remaining === 1
              ? "Just 1 portion left to complete this basket!"
              : `${remaining} portions still available.`}
          </p>
        )}
        {(basket.status === "open" || basket.status === "committed") &&
          basket.expiresAt && (
            <p className="mt-1 text-sm text-muted">
              Closes {formatDate(basket.expiresAt)} if it hasn&apos;t merged.
            </p>
          )}
        <p className="mt-1 text-sm text-muted">
          Delivery about {basket.commodity.deliveryLeadDays} days after it completes.
        </p>
        {basketSavings > 0 && (
          <p className="mt-1 text-sm font-medium text-accent-600">
            This basket saves {formatGBP(basketSavings)} vs shop prices so far.
          </p>
        )}
        {isOpen && (
          <div className="mt-4">
            <NoFillNoFee />
          </div>
        )}
      </div>

      {/* Shared ledger */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Members &amp; shares
        </h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="pb-2 font-medium">Member</th>
              <th className="pb-2 font-medium">Portions</th>
              <th className="pb-2 text-right font-medium">Owes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {basket.claims.map((c) => (
              <tr key={c.id}>
                <td className="py-2 text-ink">
                  {c.user.name}
                  {c.userId === basket.organiserId && (
                    <span className="ml-2 text-xs text-accent-600">organiser</span>
                  )}
                  {c.userId === user.id && (
                    <span className="ml-2 text-xs text-muted">(you)</span>
                  )}
                </td>
                <td className="py-2 text-muted">{c.portions}</td>
                <td className="py-2 text-right font-medium text-ink">
                  {formatGBP(c.portions * price)}
                </td>
                {isOrganiser && isOpen && (
                  <td className="py-2 pl-3 text-right">
                    {c.userId !== basket.organiserId && (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="basketId" value={basket.id} />
                        <input type="hidden" name="userId" value={c.userId} />
                        <button
                          type="submit"
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line">
              <td className="pt-2 font-semibold text-ink">Total</td>
              <td className="pt-2 font-semibold text-ink">{filled}</td>
              <td className="pt-2 text-right font-semibold text-ink">
                {formatGBP(totalOwed)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions while open */}
      {isOpen && (
        <div className="card space-y-5">
          <ClaimForm
            basketId={basket.id}
            remaining={remaining}
            currentPortions={myClaim?.portions ?? 0}
          />

          <div className="border-t border-line pt-5">
            <p className="label">Invite your group</p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">
                {basket.inviteCode}
              </code>
              <CopyButton value={inviteUrl} />
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary py-2"
              >
                Share on WhatsApp
              </a>
            </div>
            <p className="mt-2 text-xs text-muted">
              {deliveryFee > 0
                ? `Delivery is ${formatGBP(deliveryFee)} per person — free for you as the organiser.`
                : "Anyone with the link can join and claim portions."}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-line pt-5">
            {isOrganiser && (
              <>
                <form action={commitBasketAction}>
                  <input type="hidden" name="basketId" value={basket.id} />
                  <button type="submit" className="btn-accent" disabled={filled < 1}>
                    Commit basket to buy
                  </button>
                </form>
                <form action={cancelBasketAction}>
                  <input type="hidden" name="basketId" value={basket.id} />
                  <button type="submit" className="btn-danger">
                    Cancel basket
                  </button>
                </form>
              </>
            )}
            {!isOrganiser && myClaim && (
              <form action={leaveBasketAction}>
                <input type="hidden" name="basketId" value={basket.id} />
                <button type="submit" className="btn-danger">
                  Leave basket
                </button>
              </form>
            )}
          </div>
          {isOrganiser && (
            <p className="text-xs text-muted">
              Committing locks the basket and looks for complementary baskets to
              complete a whole {basket.commodity.bulkUnitLabel}.
            </p>
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
  );
}
