import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  CRON_MAX_DURATION_SECONDS,
  MAX_PAYMENT_ATTEMPTS,
  MAX_PAYMENT_RETRIES,
  PAYMENT_RECONCILE_AFTER_MINUTES,
} from "./constants";

// These are not decorative assertions. Each one guards a relationship between
// two numbers that live in different files, where breaking the relationship
// produces no error and no test failure anywhere else — it just quietly
// reopens a way to charge a customer twice.
describe("payment timing constants", () => {
  // The reconciler decides an attempt is interrupted once it is older than
  // PAYMENT_RECONCILE_AFTER_MINUTES. That is only safe because the runtime has
  // already killed the run at CRON_MAX_DURATION_SECONDS, so no charge call can
  // still be in flight at that age. If the timeout ever grew past the
  // threshold, a reconciler could read Stripe mid-call, see nothing yet, and
  // authorise a second charge.
  it("gives the reconciler threshold a wide margin over the cron timeout", () => {
    const thresholdSeconds = PAYMENT_RECONCILE_AFTER_MINUTES * 60;
    expect(thresholdSeconds).toBeGreaterThan(CRON_MAX_DURATION_SECONDS);
    // Not merely greater: greater with room to spare, so that raising the
    // timeout has to be a deliberate act that fails this test first.
    expect(thresholdSeconds).toBeGreaterThanOrEqual(CRON_MAX_DURATION_SECONDS * 2);
  });

  // Next.js requires `maxDuration` to be a literal in the route segment, so it
  // cannot import the constant. Read the file and check the two agree, rather
  // than trusting a comment to keep them in step.
  it("matches the maxDuration the cron route actually exports", () => {
    const route = readFileSync(
      path.join(__dirname, "../app/api/cron/cycles/route.ts"),
      "utf8"
    );
    const match = route.match(/export const maxDuration = (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(CRON_MAX_DURATION_SECONDS);
  });

  // The attempt cap is the termination guarantee, so it has to be reachable
  // beyond the retry budget: if it were the smaller of the two, orders would be
  // released before they had used the confirmed failures they are entitled to.
  it("caps total attempts above the established-failure budget", () => {
    expect(MAX_PAYMENT_ATTEMPTS).toBeGreaterThan(MAX_PAYMENT_RETRIES);
  });
});
