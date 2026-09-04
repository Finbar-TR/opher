import "server-only";
import { sendEmail, emailLayout, emailButton } from "./email";
import { sanitizeAppUrl } from "./base-url";
import { prisma } from "./prisma";
import { formatGBP } from "./money";
import { formatWeekday } from "./dates";

const appUrl = () => sanitizeAppUrl();

// Password-reset link.
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  rawToken: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Reset your Opher password",
    html: emailLayout(
      `<p>Hi ${name},</p>
       <p>We received a request to reset your password. This link expires in 1 hour.</p>
       ${emailButton(`${appUrl()}/reset-password?token=${rawToken}`, "Reset password")}
       <p style="color:#5b6b62;font-size:13px">If you didn't request this, you can ignore this email.</p>`
    ),
  });
}

// Email-verification link.
export async function sendVerificationEmail(
  email: string,
  name: string,
  rawToken: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Confirm your email for Opher",
    html: emailLayout(
      `<p>Hi ${name},</p>
       <p>Confirm your email address to finish setting up your account.</p>
       ${emailButton(`${appUrl()}/verify-email?token=${rawToken}`, "Confirm email")}`
    ),
  });
}

// Order emails. None of these may suggest a charge is conditional: every
// committed order is charged at its window's cutoff.

const orderInclude = {
  user: { select: { email: true, name: true } },
  tier: { select: { label: true } },
  basket: { include: { city: { select: { name: true } }, sku: { include: { product: { select: { name: true } } } } } },
  window: { select: { deliveryDate: true } },
} as const;

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
}

function orderLine(o: NonNullable<Awaited<ReturnType<typeof loadOrder>>>): string {
  return `${o.basket.sku.product.name} — ${o.tier.label} (${o.basket.city.name})`;
}

export async function sendJoinConfirmation(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `You're in — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>You've joined <strong>${orderLine(o)}</strong> for ${formatGBP(o.totalPence)}.</p>
       <p>Delivery is <strong>${formatWeekday(o.window.deliveryDate)}</strong>.</p>
       <p>We'll charge your card on <strong>${formatWeekday(o.cancellationDeadline)}</strong>.
          You can cancel free any time before then.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendChargeSucceeded(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Payment received — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We've charged ${formatGBP(o.totalPence)} for <strong>${orderLine(o)}</strong>.</p>
       <p>Delivery is <strong>${formatWeekday(o.window.deliveryDate)}</strong>.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendChargeFailed(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Payment problem — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We couldn't take payment for <strong>${orderLine(o)}</strong>.</p>
       <p>We'll try again automatically over the next couple of days. If it still
          doesn't go through, we'll release the order and you won't be charged —
          you're welcome to join a later basket instead.</p>
       <p>Just reply to this email if you'd like to talk to a person about it.</p>
       ${emailButton(`${appUrl()}/orders/${o.id}`, "View your order")}`
    ),
  });
}

export async function sendOrderReleased(orderId: string): Promise<void> {
  const o = await loadOrder(orderId);
  if (!o) return;

  await sendEmail({
    to: o.user.email,
    subject: `Order cancelled — ${o.basket.sku.product.name}`,
    html: emailLayout(
      `<p>Hi ${o.user.name},</p>
       <p>We weren't able to take payment for <strong>${orderLine(o)}</strong>,
          so we've cancelled it. You have <strong>not been charged</strong>.</p>
       <p>You're welcome to join the next delivery whenever you like.</p>
       ${emailButton(`${appUrl()}/baskets`, "Browse baskets")}`
    ),
  });
}
