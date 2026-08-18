import "server-only";
import { prisma } from "./prisma";
import { sendEmail, emailLayout, emailButton } from "./email";
import { formatGBP } from "./money";
import { ORDER_STATUS_LABELS, type OrderStatus } from "./constants";
import { sanitizeAppUrl } from "./base-url";

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

// "Your basket merged — pay your share" to each participant of a new order.
export async function sendOrderCreatedEmails(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { commodity: true, payments: { include: { user: true } } },
  });
  if (!order) return;

  for (const p of order.payments) {
    await sendEmail({
      to: p.user.email,
      subject: `Pay your share — ${order.commodity.name}`,
      html: emailLayout(
        `<p>Hi ${p.user.name},</p>
         <p>Your basket for <strong>${order.commodity.name}</strong> merged into a bulk order.
         Your share is <strong>${formatGBP(p.amount)}</strong> for ${p.portions} portion(s).</p>
         <p>The order is bought once everyone has paid.</p>
         ${emailButton(`${appUrl()}/orders/${orderId}`, "Pay my share")}`
      ),
    });
  }
}

// Basket closed automatically (deadline passed) without merging.
export async function sendBasketExpiredEmails(basketId: string): Promise<void> {
  const basket = await prisma.basket.findUnique({
    where: { id: basketId },
    include: { commodity: true, claims: { include: { user: true } } },
  });
  if (!basket) return;

  for (const c of basket.claims) {
    await sendEmail({
      to: c.user.email,
      subject: `Basket closed — ${basket.title}`,
      html: emailLayout(
        `<p>Hi ${c.user.name},</p>
         <p>The basket <strong>${basket.title}</strong> for ${basket.commodity.name}
         closed before it filled a whole ${basket.commodity.bulkUnitLabel}, so no order
         was placed and you haven't been charged.</p>
         ${emailButton(`${appUrl()}/catalog`, "Start a new basket")}`
      ),
    });
  }
}

// Delivery status update to each participant.
export async function sendOrderStatusEmails(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { commodity: true, payments: { include: { user: true } } },
  });
  if (!order) return;

  const label = ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status;
  for (const p of order.payments) {
    await sendEmail({
      to: p.user.email,
      subject: `${order.commodity.name} — ${label}`,
      html: emailLayout(
        `<p>Hi ${p.user.name},</p>
         <p>Your <strong>${order.commodity.name}</strong> order is now: <strong>${label}</strong>.</p>
         ${emailButton(`${appUrl()}/orders/${orderId}`, "Track delivery")}`
      ),
    });
  }
}

// Cancellation + refund notice to each participant.
export async function sendOrderCancelledEmails(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { commodity: true, payments: { include: { user: true } } },
  });
  if (!order) return;

  for (const p of order.payments) {
    const refunded = p.status === "refunded";
    await sendEmail({
      to: p.user.email,
      subject: `${order.commodity.name} — order cancelled`,
      html: emailLayout(
        `<p>Hi ${p.user.name},</p>
         <p>Your <strong>${order.commodity.name}</strong> order has been cancelled.</p>
         ${refunded ? `<p>Your payment of ${formatGBP(p.amount)} has been refunded.</p>` : ""}
         ${emailButton(`${appUrl()}/catalog`, "Start a new basket")}`
      ),
    });
  }
}
