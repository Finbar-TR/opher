import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import Stripe from "stripe";

// Everything here runs the code paths that only exist WITH a Stripe key —
// which is to say, the ones production takes and neither CI nor local dev ever
// reaches. `findIntentsForAttempt` in particular decides whether a charge may
// be made again: its empty return is the single branch that authorises
// spending a customer's money, and until this file it executed in zero tests.
//
// The fake is a hand-built object rather than a mocked SDK, so the paging loop,
// the `has_more` termination and the metadata filter all really run.

const h = vi.hoisted(() => {
  const state = {
    listPages: [] as Array<{ data: unknown[]; has_more: boolean }>,
    listCalls: [] as Array<Record<string, unknown>>,
    createImpl: (() => {
      throw new Error("createImpl not set");
    }) as (params: Record<string, unknown>, opts: Record<string, unknown>) => unknown,
    cancelImpl: (() => {
      throw new Error("cancelImpl not set");
    }) as (id: string) => unknown,
    refundCalls: [] as Array<{ params: unknown; opts: unknown }>,
    event: null as unknown,
  };

  const stripe = {
    paymentIntents: {
      list: async (params: Record<string, unknown>) => {
        state.listCalls.push(params);
        return state.listPages.shift() ?? { data: [], has_more: false };
      },
      create: async (params: Record<string, unknown>, opts: Record<string, unknown>) =>
        state.createImpl(params, opts),
      cancel: async (id: string) => state.cancelImpl(id),
    },
    refunds: {
      create: async (params: unknown, opts: unknown) => {
        state.refundCalls.push({ params, opts });
        return { id: "re_fake" };
      },
    },
    webhooks: { constructEvent: () => state.event },
  };

  return { state, stripe };
});

// Both specifiers name the same file; mocking both keeps this working whether
// the importer wrote "./stripe" (lib) or "@/lib/stripe" (the route).
vi.mock("./stripe", () => ({ stripe: h.stripe, stripeConfigured: () => true }));
vi.mock("@/lib/stripe", () => ({ stripe: h.stripe, stripeConfigured: () => true }));

const pi = (id: string, orderId: string, attemptNumber: string, status = "succeeded") => ({
  id,
  status,
  metadata: { orderId, attemptNumber },
});

const page = (data: unknown[], has_more = false) => ({ data, has_more });

beforeEach(() => {
  h.state.listPages = [];
  h.state.listCalls = [];
  h.state.refundCalls = [];
  h.state.event = null;
});

describe("findIntentsForAttempt against a live-shaped Stripe", () => {
  it("returns the intents whose metadata names this exact attempt", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    h.state.listPages = [
      page([
        pi("pi_other_order", "order_B", "0"),
        pi("pi_mine", "order_A", "0"),
        pi("pi_other_attempt", "order_A", "1"),
      ]),
    ];

    const found = await findIntentsForAttempt({
      customerId: "cus_1",
      orderId: "order_A",
      attemptNumber: 0,
      since: new Date("2026-09-01T00:00:00Z"),
      until: new Date("2026-09-02T00:00:00Z"),
    });

    // Both halves of the filter matter: an intent for a different order, and
    // an intent for a LATER attempt on the same order, are both other people's
    // money. Matching the second would make attempt 0 adopt attempt 1's charge.
    expect(found.map((p) => p.id)).toEqual(["pi_mine"]);
  });

  it("sends the customer and a bounded created range to Stripe", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    const since = new Date("2026-09-01T00:00:00Z");
    const until = new Date("2026-09-02T00:00:00Z");
    h.state.listPages = [page([])];

    await findIntentsForAttempt({
      customerId: "cus_1", orderId: "order_A", attemptNumber: 0, since, until,
    });

    // Both ends. An open-topped range is what let the search grow without
    // bound as an attempt aged, and unbounded growth is what made paging
    // unable to terminate.
    expect(h.state.listCalls[0]).toMatchObject({
      customer: "cus_1",
      limit: 100,
      created: {
        gte: Math.floor(since.getTime() / 1000),
        lte: Math.ceil(until.getTime() / 1000),
      },
    });
    // First page must not carry a cursor.
    expect(h.state.listCalls[0]).not.toHaveProperty("starting_after");
  });

  it("stops at the first page when Stripe says there are no more", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    h.state.listPages = [page([pi("pi_1", "order_A", "0")], false), page([pi("pi_2", "order_A", "0")])];

    const found = await findIntentsForAttempt({
      customerId: "cus_1", orderId: "order_A", attemptNumber: 0, since: new Date(0), until: new Date(1e12),
    });

    expect(found.map((p) => p.id)).toEqual(["pi_1"]);
    expect(h.state.listCalls).toHaveLength(1);
  });

  // The one that matters: a match on a later page must still be found. If
  // paging silently stopped at page one, this returns [] — and [] is what
  // authorises charging the card again.
  it("accumulates across pages and follows the cursor", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    h.state.listPages = [
      page([pi("pi_noise", "order_B", "0"), pi("pi_first", "order_A", "0")], true),
      page([pi("pi_second", "order_A", "0")], false),
    ];

    const found = await findIntentsForAttempt({
      customerId: "cus_1", orderId: "order_A", attemptNumber: 0, since: new Date(0), until: new Date(1e12),
    });

    expect(found.map((p) => p.id)).toEqual(["pi_first", "pi_second"]);
    expect(h.state.listCalls).toHaveLength(2);
    // The cursor is the last item of the previous page, not the last match.
    expect(h.state.listCalls[1]).toMatchObject({ starting_after: "pi_first" });
  });

  it("throws rather than returning a truncated list when paging will not end", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    // Stripe never says has_more: false.
    h.state.listPages = Array.from({ length: 20 }, (_, i) =>
      page([pi(`pi_${i}`, "order_B", "0")], true)
    );

    await expect(
      findIntentsForAttempt({
        customerId: "cus_1", orderId: "order_A", attemptNumber: 0, since: new Date(0), until: new Date(1e12),
      })
    ).rejects.toThrow(/refusing to conclude anything/);

    // Bounded, not infinite.
    expect(h.state.listCalls).toHaveLength(10);
  });

  it("treats an empty page as the end even if has_more is set", async () => {
    const { findIntentsForAttempt } = await import("./payments");
    h.state.listPages = [page([], true)];

    const found = await findIntentsForAttempt({
      customerId: "cus_1", orderId: "order_A", attemptNumber: 0, since: new Date(0), until: new Date(1e12),
    });

    expect(found).toEqual([]);
    expect(h.state.listCalls).toHaveLength(1);
  });
});

describe("chargeOrder against a live-shaped Stripe", () => {
  const params = {
    orderId: "order_A",
    attemptNumber: 0,
    amountPence: 2200,
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    idempotencyKey: "order-order_A-attempt-0",
  };

  it("sends pence, gbp, the attempt metadata and the key as a request option", async () => {
    const { chargeOrder } = await import("./payments");
    let seen: { params: Record<string, unknown>; opts: Record<string, unknown> } | null = null;
    h.state.createImpl = (p, o) => {
      seen = { params: p, opts: o };
      return { id: "pi_ok", status: "succeeded" };
    };

    const outcome = await chargeOrder(params);

    expect(outcome).toEqual({ kind: "succeeded", paymentIntentId: "pi_ok" });
    expect(seen!.params).toMatchObject({
      amount: 2200,
      currency: "gbp",
      customer: "cus_1",
      payment_method: "pm_1",
      confirm: true,
      off_session: true,
      metadata: { orderId: "order_A", attemptNumber: "0" },
    });
    // The key belongs in the SECOND argument. In the first it is silently
    // ignored and every attempt becomes a fresh charge.
    expect(seen!.opts).toEqual({ idempotencyKey: "order-order_A-attempt-0" });
    expect(seen!.params).not.toHaveProperty("idempotencyKey");
  });

  it("adopts the PaymentIntent Stripe attaches to a decline", async () => {
    const { chargeOrder } = await import("./payments");
    h.state.createImpl = () => {
      throw new Stripe.errors.StripeCardError({
        message: "Your card was declined.",
        code: "card_declined",
        payment_intent: { id: "pi_declined", status: "requires_payment_method" },
      } as never);
    };

    // Resolved through outcomeFromIntent, not hand-assembled — so the intent
    // id survives and there is something to look up later.
    expect(await chargeOrder(params)).toEqual({
      kind: "failed",
      paymentIntentId: "pi_declined",
      code: undefined,
      message: "Payment requires_payment_method",
    });
  });

  it("reports an off-session authentication requirement as requires_action", async () => {
    const { chargeOrder } = await import("./payments");
    h.state.createImpl = () => {
      throw new Stripe.errors.StripeCardError({
        message: "Authentication required",
        code: "authentication_required",
        payment_intent: {
          id: "pi_sca",
          status: "requires_action",
          last_payment_error: { code: "authentication_required", message: "Auth required" },
        },
      } as never);
    };

    expect(await chargeOrder(params)).toEqual({
      kind: "requires_action",
      paymentIntentId: "pi_sca",
      code: "authentication_required",
      message: "Auth required",
    });
  });

  // The fix for the trapped-customer bug: a determined client error is an
  // established failure, so it spends a retry and the order can reach an exit.
  it("treats a determined client error as an established failure", async () => {
    const { chargeOrder } = await import("./payments");
    h.state.createImpl = () => {
      throw new Stripe.errors.StripeInvalidRequestError({
        message: "No such PaymentMethod: 'pm_1'",
        code: "resource_missing",
      } as never);
    };

    expect(await chargeOrder(params)).toEqual({
      kind: "failed",
      code: "resource_missing",
      message: "No such PaymentMethod: 'pm_1'",
    });
  });

  it.each([
    ["a dropped connection", () => new Stripe.errors.StripeConnectionError({ message: "socket hang up" } as never)],
    ["a 500 from Stripe", () => new Stripe.errors.StripeAPIError({ message: "server error" } as never)],
    ["a rate limit", () => new Stripe.errors.StripeRateLimitError({ message: "too many requests" } as never)],
    // A reused key may name an intent created by the earlier use of it.
    ["a reused idempotency key", () => new Stripe.errors.StripeIdempotencyError({ message: "key reused" } as never)],
    ["a plain network error", () => new Error("ETIMEDOUT")],
  ])("leaves the outcome undetermined for %s", async (_label, makeErr) => {
    const { chargeOrder } = await import("./payments");
    h.state.createImpl = () => {
      throw makeErr();
    };

    expect((await chargeOrder(params)).kind).toBe("unknown");
  });
});

// Broken credentials are OUR fault, not the customer's. Recording them as a
// failed charge would spend one of their three tries, so a botched deploy would
// burn every retry on every order and cancel the whole order book within days.
// And if the key is wrong nothing will work, so the run must stop rather than
// iterate orders it cannot possibly charge.
describe("a credentials failure aborts the run", () => {
  it.each([
    ["a rejected key", () => new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key provided" } as never)],
    ["a restricted key", () => new Stripe.errors.StripePermissionError({ message: "not permitted to access this resource" } as never)],
  ])("stops on %s, having charged and changed nothing", async (_label, makeErr) => {
    const { prisma } = await import("./prisma");
    const { runCycles } = await import("./cycle-run");
    const { order } = await webhookFixture();

    // Put the order back where the cutoff phase will pick it up, with no
    // attempt history, so the whole write-ahead protocol runs.
    await prisma.paymentAttempt.deleteMany({ where: { orderId: order } });
    await prisma.order.update({
      where: { id: order },
      data: { status: "committed", paymentAttemptedAt: null },
    });
    h.state.createImpl = () => {
      throw makeErr();
    };

    const result = await runCycles(new Date("2027-01-17T08:00:00Z")); // at the cutoff

    expect(result.aborted).toBe(true);
    expect(result.charged).toBe(0);
    expect(result.chargeFailures).toBe(0);
    expect(result.released).toBe(0);

    // The order is untouched: not charged, not failed, not even claimed. A
    // misconfigured deploy does nothing rather than doing harm.
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order } });
    expect(after.status).toBe("committed");
    expect(after.paymentAttemptedAt).toBeNull();
    expect(after.paymentRetryCount).toBe(0);
    expect(after.stripePaymentIntentId).toBeNull();

    // And no attempt row survives — the write-ahead is undone, because a
    // rejected key means Stripe never saw a PaymentIntent at all.
    expect(await prisma.paymentAttempt.count({ where: { orderId: order } })).toBe(0);
  });

  it("does not report an aborted run as a success to the scheduler", async () => {
    const { prisma } = await import("./prisma");
    const { GET } = await import("@/app/api/cron/cycles/route");
    const { NextRequest } = await import("next/server");
    const { order } = await webhookFixture({ dueNow: true });

    await prisma.paymentAttempt.deleteMany({ where: { orderId: order } });
    await prisma.order.update({
      where: { id: order },
      data: { status: "committed", paymentAttemptedAt: null },
    });
    h.state.createImpl = () => {
      throw new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key" } as never);
    };
    process.env.CRON_SECRET = "cron_test_secret";

    const res = await GET(
      // The header is the only accepted form of the secret: a `?key=` query
      // string would put CRON_SECRET into every access log permanently.
      new NextRequest("http://localhost/api/cron/cycles", {
        method: "GET",
        headers: { authorization: "Bearer cron_test_secret" },
      })
    );

    // Every counter is zero on an aborted run, exactly as on a quiet day with
    // no orders due. Only the status code tells the two apart.
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, aborted: true });
  });

  // The query-string form of the secret is gone for good: it wrote CRON_SECRET
  // into access logs, proxy logs and referrers, permanently, every time the
  // cron fired. Vercel Cron sends the header, so nothing legitimate used it.
  it("refuses the secret in a query string", async () => {
    const { GET } = await import("@/app/api/cron/cycles/route");
    const { NextRequest } = await import("next/server");
    process.env.CRON_SECRET = "cron_test_secret";

    const res = await GET(
      new NextRequest("http://localhost/api/cron/cycles?key=cron_test_secret", { method: "GET" })
    );

    expect(res.status).toBe(401);
  });
});

describe("refundPaymentIntent and cancelPaymentIntent", () => {
  it("keys a refund on the intent, so overlapping runs refund once", async () => {
    const { refundPaymentIntent } = await import("./payments");
    await refundPaymentIntent("pi_dupe");
    await refundPaymentIntent("pi_dupe"); // a second, racing run

    expect(h.state.refundCalls).toHaveLength(2);
    // Same key both times: Stripe collapses them into one refund.
    expect(h.state.refundCalls.map((c) => c.opts)).toEqual([
      { idempotencyKey: "refund-pi_dupe" },
      { idempotencyKey: "refund-pi_dupe" },
    ]);
  });

  it("reports a cancelled intent as a failure", async () => {
    const { cancelPaymentIntent } = await import("./payments");
    h.state.cancelImpl = (id) => ({ id, status: "canceled" });

    expect(await cancelPaymentIntent("pi_sca")).toMatchObject({
      kind: "failed",
      paymentIntentId: "pi_sca",
    });
  });

  // The race the cancel exists to close: the customer authenticated just before
  // we gave up. Stripe refuses the cancel and hands back the succeeded intent,
  // and we must adopt the payment rather than discard it.
  it("adopts a payment that succeeded while we were cancelling it", async () => {
    const { cancelPaymentIntent } = await import("./payments");
    h.state.cancelImpl = () => {
      throw new Stripe.errors.StripeInvalidRequestError({
        message: "You cannot cancel this PaymentIntent because it has a status of succeeded.",
        code: "payment_intent_unexpected_state",
        payment_intent: { id: "pi_sca", status: "succeeded" },
      } as never);
    };

    expect(await cancelPaymentIntent("pi_sca")).toEqual({
      kind: "succeeded",
      paymentIntentId: "pi_sca",
    });
  });

  it("returns no opinion when the cancel itself fails", async () => {
    const { cancelPaymentIntent } = await import("./payments");
    h.state.cancelImpl = () => {
      throw new Error("ETIMEDOUT");
    };

    // null means "no better information", not "cancelled" — the caller keeps
    // its original resolution.
    expect(await cancelPaymentIntent("pi_sca")).toBeNull();
  });
});

// A `requires_action` intent is alive until something kills it. Resolving the
// attempt without cancelling would leave it able to succeed later, after the
// webhook had lost the ability to act on it and attempt N+1 had already
// charged the card.
describe("resolving requires_action", () => {
  it("cancels the intent, so it is established dead rather than assumed dead", async () => {
    const { prisma } = await import("./prisma");
    const { resolveChargeOutcome } = await import("./cycle-run");
    const { order, attempt } = await webhookFixture();

    const cancelled: string[] = [];
    h.state.cancelImpl = (id) => {
      cancelled.push(id);
      return { id, status: "canceled" };
    };

    await resolveChargeOutcome({
      attemptId: attempt,
      orderId: order,
      outcome: { kind: "requires_action", paymentIntentId: "pi_sca", code: "authentication_required" },
      now: new Date(),
    });

    expect(cancelled).toEqual(["pi_sca"]);
    const after = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt } });
    expect(after.status).toBe("requires_action");
    expect(after.errorCode).toBe("authentication_required");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order } });
    expect(o.status).toBe("payment_failed");
    expect(o.paymentRetryCount).toBe(1);
  });

  // The race the cancel closes: the customer authenticated a moment before we
  // gave up. Discarding that would be a charge with nothing recording it.
  it("adopts the payment if the customer authenticated first", async () => {
    const { prisma } = await import("./prisma");
    const { resolveChargeOutcome } = await import("./cycle-run");
    const { order, attempt } = await webhookFixture();

    h.state.cancelImpl = () => {
      throw new Stripe.errors.StripeInvalidRequestError({
        message: "cannot cancel a succeeded PaymentIntent",
        code: "payment_intent_unexpected_state",
        payment_intent: { id: "pi_sca", status: "succeeded" },
      } as never);
    };

    await resolveChargeOutcome({
      attemptId: attempt,
      orderId: order,
      outcome: { kind: "requires_action", paymentIntentId: "pi_sca" },
      now: new Date(),
    });

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order } });
    expect(o.status).toBe("paid");
    expect(o.stripePaymentIntentId).toBe("pi_sca");
    // Adopted, not penalised: the payment succeeded.
    expect(o.paymentRetryCount).toBe(0);
    const after = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt } });
    expect(after.status).toBe("succeeded");
  });
});

describe("the payment_intent webhook", () => {
  const post = async (body = "{}") => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { NextRequest } = await import("next/server");
    return POST(
      new NextRequest("http://localhost/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": "t=1,v1=fake" },
      })
    );
  };

  const succeededEvent = (metadata: Record<string, string>) => ({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_hook", status: "succeeded", metadata } },
  });

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  it("resolves the attempt the intent names", async () => {
    const { prisma } = await import("./prisma");
    const { order, attempt } = await webhookFixture();
    h.state.event = succeededEvent({ orderId: order, attemptNumber: "0" });

    const res = await post();
    expect(res.status).toBe(200);

    const after = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt } });
    expect(after.status).toBe("succeeded");
    expect(after.stripePaymentIntentId).toBe("pi_hook");

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order } });
    expect(o.status).toBe("paid");
    expect(o.stripePaymentIntentId).toBe("pi_hook");
  });

  // A 500 here tells Stripe to redeliver an event that will never make sense,
  // for days. Unrecognisable metadata has to be a 200.
  it.each([
    ["no metadata at all", {}],
    ["an order but no attempt number", { orderId: "order_x" }],
    ["a blank attempt number", { orderId: "order_x", attemptNumber: "" }],
    ["a non-numeric attempt number", { orderId: "order_x", attemptNumber: "abc" }],
    ["an order that does not exist", { orderId: "order_missing", attemptNumber: "0" }],
  ])("returns 200 for %s", async (_label, metadata) => {
    h.state.event = succeededEvent(metadata as Record<string, string>);
    const res = await post();
    expect(res.status).toBe(200);
  });

  it("is idempotent — a redelivered event changes nothing", async () => {
    const { prisma } = await import("./prisma");
    const { order } = await webhookFixture();
    h.state.event = succeededEvent({ orderId: order, attemptNumber: "0" });

    await post();
    await post();

    const o = await prisma.order.findUniqueOrThrow({ where: { id: order } });
    expect(o.status).toBe("paid");
    // The second delivery must not have re-run the resolution.
    expect(o.paymentRetryCount).toBe(0);
  });

  // The orphan guard: an established success arriving after the attempt was
  // resolved some other way is money with no order recording it.
  it("records an orphaned success against an already-abandoned attempt", async () => {
    const { prisma } = await import("./prisma");
    const { order, attempt } = await webhookFixture();
    await prisma.paymentAttempt.update({
      where: { id: attempt },
      data: { status: "abandoned", resolvedAt: new Date() },
    });

    h.state.event = succeededEvent({ orderId: order, attemptNumber: "0" });
    const res = await post();
    expect(res.status).toBe(200);

    const after = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt } });
    expect(after.status).toBe("abandoned"); // not overwritten
    expect(after.orphanedPaymentIntentId).toBe("pi_hook"); // but recoverable
  });
});

const WEBHOOK_TAG = "ZZTEST_HOOK_" + Date.now();

// These fixtures sit in `payment_pending` with pending attempts, which is
// exactly what another suite's reconciler sweep would pick up. Clear them.
afterAll(async () => {
  const { prisma } = await import("./prisma");
  const where = { basket: { city: { name: { startsWith: WEBHOOK_TAG } } } };
  await prisma.paymentAttempt.deleteMany({ where: { order: where } });
  await prisma.order.deleteMany({ where });
  await prisma.basketTier.deleteMany({ where: { basket: { city: { name: { startsWith: WEBHOOK_TAG } } } } });
  await prisma.basket.deleteMany({ where: { city: { name: { startsWith: WEBHOOK_TAG } } } });
  await prisma.deliveryWindow.deleteMany({ where: { city: { name: { startsWith: WEBHOOK_TAG } } } });
  await prisma.city.deleteMany({ where: { name: { startsWith: WEBHOOK_TAG } } });
  await prisma.sku.deleteMany({ where: { product: { name: { startsWith: WEBHOOK_TAG } } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: WEBHOOK_TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: WEBHOOK_TAG } } });
});

// `dueNow` puts the window's cutoff just behind the real clock, for the tests
// that call runCycles() with no argument (as the cron route does) and need the
// cutoff phase to actually pick the order up.
async function webhookFixture(opts: { dueNow?: boolean } = {}) {
  const { prisma } = await import("./prisma");
  const suffix = Math.random().toString(16).slice(2, 8);
  const city = await prisma.city.create({
    data: {
      name: `${WEBHOOK_TAG} ${suffix}`,
      slug: `${WEBHOOK_TAG}-${suffix}`.toLowerCase(),
      anchorDate: new Date("2027-01-20T00:00:00Z"),
      active: false,
    },
  });
  const product = await prisma.product.create({ data: { name: `${WEBHOOK_TAG} ${suffix}` } });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id, label: "Yam", weightGrams: 25000, wholesaleCostPence: 4000,
      purchaseThresholdGrams: 0, stockAt3pl: 0, leadTimeDays: 2,
    },
  });
  const admin = await prisma.user.create({
    data: { email: `${WEBHOOK_TAG}-${suffix}-ops@test`, name: "Ops", passwordHash: "x" },
  });
  const basket = await prisma.basket.create({
    data: {
      cityId: city.id, skuId: sku.id, label: `${WEBHOOK_TAG} ${suffix}`, createdById: admin.id,
      tiers: { create: [{ label: "T", weightGrams: 10000, pricePence: 2200, displayOrder: 1 }] },
    },
    include: { tiers: true },
  });
  const cutoff = opts.dueNow
    ? new Date(Date.now() - 60 * 60 * 1000)
    : new Date("2027-01-17T08:00:00Z");
  const delivery = opts.dueNow
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : new Date("2027-01-20T00:00:00Z");
  const window = await prisma.deliveryWindow.create({
    data: { cityId: city.id, deliveryDate: delivery, cutoffAt: cutoff, status: "locked" },
  });
  const user = await prisma.user.create({
    data: { email: `${WEBHOOK_TAG}-${suffix}-u@test`, name: "U", passwordHash: "x" },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id, basketId: basket.id, basketTierId: basket.tiers[0].id,
      deliveryWindowId: window.id, status: "payment_pending",
      stripeCustomerId: "cus_test", stripePaymentMethodId: "pm_test",
      debitDate: cutoff, cancellationDeadline: cutoff,
      paymentAttemptedAt: new Date(), totalPence: 2200, deliveryAddress: "1 Test Street",
    },
  });
  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: order.id, attemptNumber: 0,
      idempotencyKey: `order-${order.id}-attempt-0`, status: "pending",
    },
  });
  return { order: order.id, attempt: attempt.id };
}
