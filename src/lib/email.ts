import "server-only";

// Transactional email. Uses Resend's HTTP API when RESEND_API_KEY is set;
// otherwise logs to the console so local dev works with no provider. Never
// throws — a failed notification must not break the action that triggered it.

type SendArgs = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: SendArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Opher <onboarding@resend.dev>";

  if (!key) {
    console.log(`[email:dev] to=${to} · subject="${subject}"`);
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error("[email] send failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[email] error", err);
  }
}

// Minimal branded HTML wrapper for message bodies.
export function emailLayout(bodyHtml: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#14201a">
    <div style="background:#087443;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:700;font-size:18px">Opher</div>
    <div style="border:1px solid #e7e3da;border-top:none;border-radius:0 0 12px 12px;padding:20px">${bodyHtml}</div>
  </div>`;
}

export function emailButton(href: string, label: string): string {
  return `<p><a href="${href}" style="display:inline-block;background:#087443;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${label}</a></p>`;
}
