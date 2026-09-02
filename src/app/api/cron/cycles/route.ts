import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runCycles } from "@/lib/cycle-run";

// The run is fully sequential with a Stripe round-trip per order, so Vercel's
// default function timeout is not enough headroom on a city with any real
// volume — and a timeout mid-run is the likeliest way to strand an order
// mid-charge, which is exactly what the reconciler exists for.
//
// RAISING THIS IS NOT A LOCAL DECISION. It must stay comfortably BELOW
// PAYMENT_RECONCILE_AFTER_MINUTES (src/lib/constants.ts): the reconciler
// treats an attempt older than that as interrupted, so if a run could still be
// alive at that age, a reconciler could race a charge call that is still in
// flight and authorise a second one. `constants.test.ts` asserts the
// relationship. Next requires a literal here, so the value is duplicated from
// CRON_MAX_DURATION_SECONDS and the test checks the two agree.
export const maxDuration = 300;

// Constant-time comparison of the Authorization header against the expected
// bearer token. `timingSafeEqual` throws on a length mismatch, so the lengths
// are compared first — the length of a bearer token is not itself a secret,
// and the alternative (padding) leaks the same fact more obscurely.
function authorize(header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = Buffer.from(header, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// The daily cutoff run. Protect with CRON_SECRET and call at 08:00 UTC with:
//   Authorization: Bearer <CRON_SECRET>
// Supports GET and POST so it's easy to wire from any scheduler. Vercel Cron
// sends exactly this header when CRON_SECRET is set.
//
// There is deliberately NO `?key=<secret>` fallback. A secret in a query string
// is written to every access log, proxy log and referrer along the way, and
// stays there permanently — a credential that leaks by being used.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }

  if (!authorize(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCycles();

  // An aborted run charged nobody because Stripe rejected our credentials.
  // Reporting that as 200 would let a broken deploy look like a quiet day with
  // no orders due — the counters are all zero either way. A 503 is what makes
  // the scheduler's own alerting page someone.
  if (result.aborted) {
    return NextResponse.json(
      { ok: false, error: "Stripe credentials rejected — no orders were charged", ...result },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
