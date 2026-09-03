# Opher

A food aggregation & bulk-buying **PWA** for the UK. Each city runs a delivery
twice a month; members **join** a basket for a food in their city, choosing a
quantity tier. Three days before delivery the basket closes — every joined
order is charged and the operator buys supply for the delivery by hand.

Built with **Next.js 16 (App Router) · Prisma · SQLite (dev) / Postgres (prod) ·
Stripe · Tailwind v4**. Installable as a PWA — no app-store fees.

## Getting started

```bash
npm install
cp .env.example .env         # defaults work for local dev
npm run db:push              # create the SQLite schema
npm run db:seed              # operator + members + cities + catalogue + baskets
npm run dev                  # http://localhost:3000
```

### Seeded accounts (password `password123`)

| Email                 | Role     |
| --------------------- | -------- |
| `operator@opher.test` | operator |
| `aisha@opher.test`    | member   |
| `ben@opher.test`      | member   |

Optional: `npx tsx scripts/seed-scenario.ts` adds joined orders for clicking
through the UI — a basket with several joiners, one with a single joiner, one
whose window is closing soon, and one with a mix of committed/paid/cancelled
orders.

## The flow

1. **Operator** sets each city's delivery schedule — a fortnightly date series
   and how many days before delivery joining closes (default 3).
2. **Operator** curates products and SKUs, then opens a **basket** for one food
   in one city, with 2–4 quantity tiers (e.g. 2 kg £9.50 … 20 kg £72).
3. A **member** browses baskets in their city and **joins** one, choosing a
   tier. Their card is saved but not charged.
4. Three days before delivery the window **closes** at 08:00 UTC, and **every**
   committed order in it is charged — there is no minimum demand: two joiners
   are supplied as readily as ten. A window whose demand is too thin can be
   **rolled over** to the next date by the operator instead of running it.
5. The **operator** buys the goods by hand from the supplier and delivers on
   the city's delivery date.

## Scripts

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Dev server                             |
| `npm run build`     | Production build                       |
| `npm test`          | Vitest (cycle logic + DB integration)  |
| `npm run db:push`   | Sync schema to the database            |
| `npm run db:seed`   | Seed accounts + catalog                |
| `npm run db:studio` | Prisma Studio                          |

## Payments (Stripe)

Joining a basket saves a card with a Stripe SetupIntent — no charge yet. The card is
only charged at the window's cutoff, by the daily cron below. Local dev works
**without** Stripe: joining and charging both use synthetic ids and report success,
so the whole join → cutoff → charge path is clickable with no keys set. To use real
(test-mode) payments, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`
and forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Money is stored in integer **pence** throughout, weights in integer **grams**.
Opher never holds pooled funds — a card is charged only once, at cutoff, which keeps
it clear of UK e-money licensing. **Do not** add a "top up in advance" wallet without
regulatory advice.

## Notifications (email)

Password-reset and email-verification links are sent, alongside four order emails:
join confirmation, payment succeeded, payment failed, and order cancelled/released.
In dev with no `RESEND_API_KEY`, emails are logged to the console instead of sent.
Set `RESEND_API_KEY` + `EMAIL_FROM` to send for real.

## Deploying

The full deploy guide (**Vercel** + free **Neon Postgres**, with the domain pointed
from Hostinger and the delivery-cycle cron on Vercel Cron) is in
[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md). Local dev stays on SQLite; the
`prebuild` step selects the Prisma provider from `DATABASE_URL` automatically
(`file:` → sqlite, `postgres://` → postgresql, `mysql://` → mysql).

## Delivery cycles (scheduled)

`GET|POST /api/cron/cycles` (guarded by `CRON_SECRET`) runs daily at **08:00
UTC** — the hour every window's cutoff falls at, because the cutoff and the charge
are the same moment. Each run:

1. **Reconciles** any charge attempt an earlier, interrupted run left unresolved,
   against Stripe — never against a guess.
2. **Advances** windows: dispatches deliveries whose date has passed, and opens new
   windows so every city always has its next two deliveries visible.
3. **Locks** every window whose cutoff has arrived and **charges** every committed
   order in it.
4. **Retries** charges that failed, up to the retry budget, and releases orders that
   exhaust it.

It runs on **Vercel Cron** (configured in `vercel.json`; Vercel auto-sends the
`CRON_SECRET`).

### Payment safety

Charging happens once, by design, even across a crashed or overlapping run:

- Every attempt is **recorded before the Stripe call is made** (`PaymentAttempt`,
  written `pending`), so a process that dies mid-charge always leaves evidence that
  a charge may have happened.
- An interrupted attempt is never assumed to have failed. The next run
  **reconciles it against Stripe** — asking what actually happened — before
  touching that order again, so an interrupted run cannot double-charge.
- If reconciliation ever finds two successful charges for one attempt, the
  duplicate is **detected and refunded automatically**, leaving the order charged
  correctly exactly once.

## Environment variables

`DATABASE_URL` (`file:` sqlite / `mysql://` / `postgres://`), `SESSION_SECRET`,
`APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`,
`CRON_SECRET` — see `.env.example`. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the
browser key Stripe Elements uses to collect a card during join; without it the
join flow falls back to a keyless dev path that saves a placeholder card
instead of calling Stripe. Regenerate PWA icons with `npm run gen:icons`.
Before a public launch, have a solicitor review `/privacy`, `/terms`,
`/cookies` (UK-oriented templates) and confirm food-hygiene registration if
you handle food.

## What's covered

- Accounts with email verification, password reset, rate-limited login, and an
  account page (name, **delivery address**, password).
- City delivery schedules; an operator-curated catalogue of products and SKUs;
  admin-created baskets with 2–4 quantity tiers priced per kg.
- Browsing baskets by city and joining one with a card saved via Stripe
  Elements — a three-step flow (address, size, card) that never charges at
  join time.
- My-orders, with free cancellation until the basket closes.
- Four order emails — join confirmation, payment succeeded, payment failed,
  and order cancelled/released — alongside the existing password-reset and
  email-verification mail.
- The cutoff cron charges every committed order in a window at its city's
  cutoff, with no minimum demand, automatic payment retries, and operator
  refunds for a single order or a whole delivery.

## Roadmap

Operator screens for cities, baskets, the demand dashboard and refunds; rolling
a thin window over to the next delivery date instead of running it;
courier-API tracking; a supplier marketplace; push notifications; and Capacitor
store wrappers.
