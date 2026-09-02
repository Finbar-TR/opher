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
      amountPence: 2200,
      customerId: "dev_cus_1",
      paymentMethodId: "dev_pm_1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paymentIntentId).toMatch(/^dev_pi_/);
  });

  it("refunds and detaches without throwing", async () => {
    const { refundPaymentIntent, detachPaymentMethod } = await import("./payments");
    await expect(refundPaymentIntent("dev_pi_1")).resolves.toBeUndefined();
    await expect(detachPaymentMethod("dev_pm_1")).resolves.toBeUndefined();
  });
});
