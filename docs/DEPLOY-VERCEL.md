# Deploying Opher to Vercel (with your Hostinger domain)

The app runs on **Vercel** (built for Next.js, free Hobby tier), the database is a free
managed **Neon Postgres**, and **morsetltd.com** stays registered at Hostinger — you
just point its DNS at Vercel. The auto-expiry cron runs on **Vercel Cron** (built in,
no external scheduler).

Local dev stays on SQLite; the `prebuild` step selects the Postgres provider from the
Neon `DATABASE_URL` automatically.

---

## 1. Put the code on GitHub

```bash
cd /c/Desktop/Opher
git init && git add -A && git commit -m "Opher MVP"
# create an empty repo on github.com, then:
git remote add origin https://github.com/YOUR_USER/opher.git
git branch -M main && git push -u origin main
```

## 2. Create the database (Neon Postgres — free)

1. Sign up at [neon.tech](https://neon.tech) and create a project (pick a region near
   your users, e.g. London/EU).
2. Copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.eu-west-2.aws.neon.tech/neondb?sslmode=require`).
3. Apply the schema from your machine (this generates the Postgres client via the
   prebuild provider-select):

   ```bash
   export DATABASE_URL="postgresql://…neon…/neondb?sslmode=require"
   node scripts/select-prisma-provider.mjs   # flips schema to postgresql
   npx prisma db push
   npx tsx prisma/seed.ts                     # optional: operator + sample catalog
   git checkout prisma/schema.prisma          # restore sqlite for local dev
   ```

## 3. Import the project into Vercel

1. At [vercel.com/new](https://vercel.com/new), import your GitHub repo. Vercel
   auto-detects Next.js — no build config needed.
2. Add **Environment Variables** (Settings → Environment Variables, all environments):

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | your Neon connection string |
   | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `APP_URL` | `https://morsetltd.com` |
   | `STRIPE_SECRET_KEY` | from Stripe |
   | `STRIPE_WEBHOOK_SECRET` | from Stripe (step 6) |
   | `RESEND_API_KEY` | from Resend |
   | `EMAIL_FROM` | `Opher <noreply@morsetltd.com>` |
   | `CRON_SECRET` | a long random string |

3. Click **Deploy**. You'll get a `*.vercel.app` URL to test against.

## 4. Point morsetltd.com at Vercel (DNS stays at Hostinger)

1. In Vercel: Project → Settings → **Domains** → add `morsetltd.com` (and
   `www.morsetltd.com`). Vercel shows the exact records to create.
2. In Hostinger hPanel → **Domains → DNS / Nameservers → DNS zone**, add what Vercel
   asks for — typically:
   - **A** record: `@` → `76.76.21.21`
   - **CNAME** record: `www` → `cname.vercel-dns.com`
3. Wait for DNS to propagate (minutes to a couple of hours). Vercel issues HTTPS
   automatically. Then update `APP_URL` to `https://morsetltd.com` and redeploy.

## 5. Auto-expiry cron (already wired)

`vercel.json` schedules `/api/cron/expire` daily at 02:00 UTC. Because `CRON_SECRET`
is set, Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`, which the
endpoint checks — nothing else to configure. (Daily is the Hobby-plan cadence; a paid
plan can run it more often.)

## 6. Stripe webhook

In the Stripe dashboard add an endpoint
`https://morsetltd.com/api/stripe/webhook` for `checkout.session.completed`, then put
its signing secret into the `STRIPE_WEBHOOK_SECRET` env var and redeploy.

## 7. Redeploys

Just `git push` — Vercel builds and deploys automatically. If you change the schema,
run `npx prisma db push` against `DATABASE_URL` again first.

---

## Notes

- **Serverless + Prisma:** Neon handles pooling well. If you ever see connection limits
  under load, switch `DATABASE_URL` to Neon's **pooled** connection string.
- **Email/verification:** verify your sending domain in Resend so mail from
  `@morsetltd.com` isn't marked spam.
- Before public launch, have a solicitor review `/privacy`, `/terms`, `/cookies` and
  confirm food-hygiene registration if you handle food.
