import "server-only";

// Resolving the app's public base URL robustly.
//
// `APP_URL` is easy to misconfigure (stray quotes, missing scheme, trailing
// slash), and a bad value makes Stripe reject success_url. So in a request
// context we derive the origin from the request headers, and everywhere else we
// fall back to a *sanitised* APP_URL.

export function sanitizeAppUrl(): string {
  const raw = (process.env.APP_URL || "http://localhost:3000")
    .trim()
    .replace(/^['"]|['"]$/g, "") // strip surrounding quotes
    .replace(/\/+$/, ""); // strip trailing slashes
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Origin from the current request (e.g. https://opher.morsetltd.com). Use this in
// server actions / server components; falls back to APP_URL outside a request.
export async function requestBaseUrl(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    }
  } catch {
    // Not in a request scope (e.g. a cron/background call).
  }
  return sanitizeAppUrl();
}
