import { NextRequest, NextResponse } from "next/server";
import { runCycles } from "@/lib/cycle-run";

// The daily cutoff run. Protect with CRON_SECRET and call at 08:00 UTC with
// either:
//   Authorization: Bearer <CRON_SECRET>   or   ?key=<CRON_SECRET>
// Supports GET and POST so it's easy to wire from any scheduler.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  const key = req.nextUrl.searchParams.get("key");
  const authorized = auth === `Bearer ${secret}` || key === secret;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCycles();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
