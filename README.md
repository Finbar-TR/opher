# Opher

A food aggregation & bulk-buying **PWA** for the UK. Members create baskets for a
commodity, invite others, and Opher's **merge engine** combines part-filled baskets
for the same item into whole bulk units (e.g. `2/5 + 3/5 = 5/5` of a 25 kg sack).
Each participant pays only their share (collect-on-order via Stripe), and delivery
is tracked to the door.

Built with **Next.js 16 (App Router) · Prisma · SQLite (dev) / Postgres (prod) ·
Stripe · Tailwind v4**. Installable as a PWA — no app-store fees.

## Getting started

```bash
npm install
cp .env.example .env         # defaults work for local dev
npm run db:push              # create the SQLite schema
npm run db:seed              # operator + members + sample catalog
npm run dev                  # http://localhost:3000
```

### Seeded accounts (password `password123`)

| Email                 | Role     |
| --------------------- | -------- |
| `operator@opher.test` | operator |
| `aisha@opher.test`    | member   |
| `ben@opher.test`      | member   |

Optional: `npx tsx scripts/seed-scenario.ts` adds an open basket and one
in-delivery order for clicking through the UI.

## The flow

1. **Operator** curates the catalog at `/operator/commodities` — each commodity has a
   bulk unit (e.g. 25 kg sack) split into a fixed number of portions.
2. A **member** opens a basket from a commodity, choosing how many portions their
   group wants, and invites others (shareable code / `/join/<code>` link).
3. Members **claim portions**; the basket page is a shared ledger of who owes what.
4. The organiser **commits**. The [merge engine](src/lib/merge.ts) pools committed
   baskets for that commodity and forms an **order** for each whole bulk unit
   (`src/lib/merge-orders.ts`). Operators can also merge manually at `/operator/demand`.
5. Each participant **pays their share** (Stripe Checkout, or a dev fallback when no
   Stripe key is set). The order settles to `paid` once every share is in.
6. The **operator** advances fulfilment (`bought → out for delivery → delivered`) at
   `/operator/orders`; members watch the live timeline on their order.

## Scripts

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Dev server                             |
| `npm run build`     | Production build                       |
| `npm test`          | Vitest (merge engine + DB integration) |
| `npm run db:push`   | Sync schema to the database            |
| `npm run db:seed`   | Seed accounts + catalog                |
| `npm run db:studio` | Prisma Studio                          |

## Payments (Stripe)

Local dev works **without** Stripe: paying a share settles it directly. To use real
(test-mode) payments, set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env`
and forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Money is stored in integer **pence** throughout. Opher never holds pooled funds —
each share is charged at order time, which keeps it clear of UK e-money licensing.
**Do not** add a "top up in advance" wallet without regulatory advice.

## Notifications (email)

Transactional emails fire when an order is created (pay your share), on each
delivery status change, and on cancellation/refund — plus password-reset and
email-verification links. In dev with no `RESEND_API_KEY`, emails are logged to the
console. Set `RESEND_API_KEY` + `EMAIL_FROM` to send for real.

## Deploying

The full deploy guide (**Vercel** + free **Neon Postgres**, with the domain pointed
from Hostinger and the expiry cron on Vercel Cron) is in
[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md). Local dev stays on SQLite; the
`prebuild` step selects the Prisma provider from `DATABASE_URL` automatically
(`file:` → sqlite, `postgres://` → postgresql, `mysql://` → mysql).

## Auto-expiry (scheduled)

`GET|POST /api/cron/expire` (guarded by `CRON_SECRET`) cancels open/committed baskets
past their close date and cancels + refunds `pending_payment` orders past their due
date. It runs on **Vercel Cron** (configured in `vercel.json`; Vercel auto-sends the
`CRON_SECRET`). Basket close windows are set per-basket at creation; order payment
windows default to 3 days.

## Environment variables

`DATABASE_URL` (`file:` sqlite / `mysql://` / `postgres://`), `SESSION_SECRET`,
`APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`EMAIL_FROM`, `CRON_SECRET` — see `.env.example`. Regenerate PWA icons with
`npm run gen:icons`. Before a public launch, have a solicitor review `/privacy`,
`/terms`, `/cookies` (UK-oriented templates) and confirm food-hygiene registration if
you handle food.

## What's covered

- Accounts with email verification, password reset, rate-limited login, and an account
  page (name, **delivery address**, password).
- Operator-curated catalog; baskets with a shared ledger; the merge engine; per-share
  Stripe payments (dev fallback without keys); manual delivery tracking.
- Basket lifecycle (re-open, cancel, remove member) and operator order **cancel +
  refund** for stuck/unpaid orders.

## Roadmap

Courier-API tracking, richer multi-unit bin-packing merges, a supplier marketplace,
push notifications, and Capacitor store wrappers.
