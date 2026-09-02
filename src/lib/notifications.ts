import "server-only";
import { sendEmail, emailLayout, emailButton } from "./email";
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
