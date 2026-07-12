# BGM Office — Code Review & Roadmap

Reviewed 2026-07-12, just after the Supabase/Vercel migration. This is an honest
assessment of the current setup plus a prioritized plan. Nothing here is urgent-
scary except Phase 0, which is genuinely important and quick.

Overall: the app is in good shape for its size. The architecture is reasonable, the
code is clean and consistent, and the migration landed correctly. The issues below
are mostly "you inherited these from the SQLite era" and "security defaults that were
never turned on," not bad decisions.

---

## Phase 0 — Security, do this first (about 1 hour total)

These are the real ones. Each is small.

### 0.1 Turn on Row Level Security (RLS) in Supabase — MOST IMPORTANT
Right now all 25 database tables have RLS **disabled**, no policies, and the public
`anon` role has full read/write grants. In Supabase's security model that means the
database is reachable through its public REST API (`https://<project>.supabase.co/rest/...`)
using the anon key, which is designed to be public. Your clients, instructors,
invoices, and the `users` table (with password hashes) are all in scope.

Your app does **not** use that REST API — it goes through your own Express server as
the `postgres` role — so turning RLS on will **not break anything** (the `postgres`
role owns the tables and bypasses RLS). This is close to a free fix.

Do this in the Supabase SQL editor:

```sql
-- Enable RLS on every table in the public schema.
-- No policies added = deny all for anon/authenticated, which is exactly what we want,
-- because the app connects as the postgres owner and bypasses RLS.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

Then confirm the app still logs in (it will). Belt-and-suspenders: you can also
disable the Data API entirely in Supabase settings, since this app never uses it.

### 0.2 Rotate JWT_SECRET — it's in your git history
`server/.env` was committed in the very first commit, so your `JWT_SECRET` is
permanently in git history. Anyone who ever sees the repo history can forge a valid
admin login token. Fix: generate a new secret and set it in Vercel + local `.env`.

```bash
# generate one
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# set it (Vercel), then redeploy
vercel env rm JWT_SECRET production
vercel env add JWT_SECRET production   # paste the new value
vercel --prod
```

Side effect: everyone gets logged out once and signs back in. That's all.

### 0.3 Change the admin password
`admin@bgmoffice.com` / `admin123` is the live admin login. Change it to something
private (in the app's user settings, or directly in the DB). Same for any other
default `staff123` accounts that are real.

### 0.4 Require the Stripe webhook signature
In `server/app.js` the Stripe webhook currently **skips signature verification** if no
webhook secret is set (it just warns and trusts the payload). That means someone who
finds the webhook URL could POST a fake "payment succeeded" and mark invoices paid.
Set `STRIPE_WEBHOOK_SECRET` and make the handler reject requests when it's missing,
instead of falling back to `JSON.parse`.

---

## Phase 1 — Reliability (a weekend, whenever)

### 1.1 Error monitoring
Right now errors only land in `console.error` → Vercel logs, which nobody watches.
Add Sentry (free tier) or at least a catch-all that pings you. For a business app that
handles invoices, silent failures are the thing that bites.

### 1.2 A real health check + uptime ping
There's `GET /api/health`. Point a free uptime monitor (UptimeRobot, Better Stack) at
it so you find out the site is down before a client does. This is exactly what would
have caught the Railway backend dying three days before anyone noticed.

### 1.3 Confirm the Supabase connection limits
You're on Supabase's Nano compute (pool size ~15). Each Vercel function instance opens
its own small pool (`max: 2`) against the transaction pooler — which is the correct
setup for serverless. Just keep an eye on it as usage grows; if you see connection
errors under load, that's the first place to look.

---

## Phase 2 — Fix the data model (carried over from SQLite)

These work today but are technically wrong and will cause subtle bugs.

### 2.1 Timestamps are stored as TEXT, not real dates
Every `*_at` column is a text string written with `to_char(NOW(), 'YYYY-MM-DD ...')`.
That's a SQLite habit. In Postgres it means date sorting/filtering is string
comparison, there's no timezone, and any format drift breaks ordering. Migrate these
columns to `timestamptz` and update the code to insert real timestamps. Medium effort,
worth doing before the data grows.

### 2.2 Boolean columns stored as integers
Queries use `WHERE active = 1`. `active` is an integer, another SQLite-ism. It works,
but it's fragile — the day someone "fixes" the column to a real boolean, every one of
these queries breaks. Convert to real `boolean` and use `WHERE active` / `WHERE active = true`.

---

## Phase 3 — Quality & maintainability (ongoing)

### 3.1 There are no tests and no CI
Not a crisis at this size, but the migration is exactly the kind of change that a
handful of tests would have made painless. Start small: a few tests around auth and
invoices, run them in GitHub Actions on every push. This is the highest-leverage habit
to build as you grow.

### 3.2 Consider TypeScript (optional, longer term)
The code is plain JS and it's clean, so this is a preference, not a fix. As a newer
dev, TypeScript's autocomplete and "you passed the wrong thing" errors would catch a
lot before runtime. If you do it, do it gradually (allow JS + TS side by side).

### 3.3 Small cleanups
- Route files repeat the same `pool`/error boilerplate — a shared async wrapper would
  cut noise. Low priority.
- The client bundle is one ~1.8 MB chunk including html2canvas + DOMPurify (for PDF/
  print). Code-splitting those behind the invoice/print screens would speed first load.
- CORS default origin still falls back to the old Netlify URL in `app.js` — harmless
  once `ALLOWED_ORIGIN` is set in Vercel, but tidy it up.

---

## What's already good (don't touch)

- Clean separation: `app.js` builds the app, `index.js` listens, `api/index.js` is the
  serverless entry. Correct for Vercel.
- All SQL is parameterized (`$1`, `$2`) — no SQL injection surface. Nicely done.
- Single API wrapper on the client (`api/client.js`) — one place for all fetch calls.
- Password hashing with bcrypt, JWT with expiry, login rate-limiting — the fundamentals
  are there.
- Transaction pooler (port 6543) for serverless — the right connection choice.
- Zero npm vulnerabilities in server deps.

---

## Suggested order

1. Phase 0 in full (this week) — RLS, rotate JWT, change admin pw, Stripe webhook.
2. Finish the migration loose ends (DNS to Vercel, push to GitHub).
3. Phase 1 (error monitoring + uptime) — cheap insurance.
4. Phase 2 (timestamps + booleans) — before the dataset grows.
5. Phase 3 as an ongoing habit.

Reviewed by Yidy. Questions — just ask.
