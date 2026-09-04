import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";

// The dev fallback is what runs with no STRIPE_SECRET_KEY set, and it is the
// path local development and CI take. Mock the stripe module as unconfigured.
vi.mock("./stripe", () => ({ stripe: null, stripeConfigured: () => false }));

beforeEach(() => vi.resetModules());

const TAG = "ZZTEST_PAY_" + Date.now();
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `${TAG}@test`, name: "Pay", passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
});

describe("payments without a Stripe key", () => {
  it("mints a synthetic customer id and persists it for reuse", async () => {
    const { ensureStripeCustomer } = await import("./payments");
    const id = await ensureStripeCustomer(userId, `${TAG}@test`, "Pay");
    expect(id).toMatch(/^dev_cus_/);

    // A repeat call for the same user must reuse the stored id, not mint a new one.
    const again = await ensureStripeCustomer(userId, `${TAG}@test`, "Pay");
    expect(again).toBe(id);
  });

  it("mints a setup intent with a usable dev payment method", async () => {
    const { createSetupIntent } = await import("./payments");
    const si = await createSetupIntent("dev_cus_1");
    expect(si.id).toMatch(/^dev_seti_/);
    expect(si.clientSecret).toBeNull();
    expect(si.devPaymentMethodId).toMatch(/^dev_pm_/);
  });

  it("reports a charge as succeeding", async () => {
    const { chargeOrder } = await import("./payments");
    const result = await chargeOrder({
      orderId: "order_1",
      attemptNumber: 0,
      amountPence: 2200,
      customerId: "dev_cus_1",
      paymentMethodId: "dev_pm_1",
      idempotencyKey: "order-order_1-attempt-0",
    });
    expect(result.kind).toBe("succeeded");
    if (result.kind === "succeeded") expect(result.paymentIntentId).toMatch(/^dev_pi_/);
  });

  // The reconciler reads "no intents" as "Stripe holds nothing, so nothing was
  // charged". With no key configured that is exactly true, and it is what lets
  // an interrupted dev/CI run settle instead of hanging.
  it("finds no payment intents for an attempt", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    const intents = await findIntentsForAttempt({
      customerId: "dev_cus_1",
      orderId: "order_1",
      attemptNumber: 0,
      since: new Date(Date.now() - 60_000),
      until: new Date(Date.now() + 60_000),
    });
    expect(intents).toEqual([]);
  });

  it("refunds and detaches without throwing", async () => {
    const { refundPaymentIntent, detachPaymentMethod } = await import("./payments");
    await expect(refundPaymentIntent("dev_pi_1")).resolves.toBeUndefined();
    await expect(detachPaymentMethod("dev_pm_1")).resolves.toBeUndefined();
  });
});

// A PaymentIntent has seven statuses, not two. Collapsing them into
// success/failure is how a customer gets wrongly released or wrongly charged,
// and this mapping is the one place all three callers — the charge path, the
// reconciler and the webhook — agree on what each means.
describe("outcomeFromIntent", () => {
  const intent = (status: string, lastError?: { code?: string; message?: string }) =>
    ({ id: `pi_${status}`, status, last_payment_error: lastError } as never);

  it("maps succeeded to a success carrying the intent id", async () => {
    const { outcomeFromIntent } = await import("./payments");
    expect(outcomeFromIntent(intent("succeeded"))).toEqual({
      kind: "succeeded",
      paymentIntentId: "pi_succeeded",
    });
  });

  it("keeps processing separate from both success and failure", async () => {
    const { outcomeFromIntent } = await import("./payments");
    expect(outcomeFromIntent(intent("processing")).kind).toBe("processing");
  });

  it("keeps requires_action separate, preserving the reason", async () => {
    const { outcomeFromIntent } = await import("./payments");
    const outcome = outcomeFromIntent(
      intent("requires_action", { code: "authentication_required", message: "Auth needed" })
    );
    expect(outcome).toEqual({
      kind: "requires_action",
      paymentIntentId: "pi_requires_action",
      code: "authentication_required",
      message: "Auth needed",
    });
  });

  it.each(["canceled", "requires_payment_method", "requires_confirmation", "requires_capture"])(
    "maps %s to a failure",
    async (status) => {
      const { outcomeFromIntent } = await import("./payments");
      expect(outcomeFromIntent(intent(status)).kind).toBe("failed");
    }
  );

  it("carries a decline code through on a failure", async () => {
    const { outcomeFromIntent } = await import("./payments");
    const outcome = outcomeFromIntent(
      intent("requires_payment_method", { code: "card_declined", message: "Your card was declined." })
    );
    expect(outcome).toEqual({
      kind: "failed",
      paymentIntentId: "pi_requires_payment_method",
      code: "card_declined",
      message: "Your card was declined.",
    });
  });
});
