# BGM Office — Claude Code Guide

Internal operations app for a private fitness/wellness business ("Bring the Gym to Me").
Manages clients, instructors, cases, invoices, scheduling, and recruiting.

## Working agreement — READ THIS FIRST

The owner, Sarede, is **not a programmer**. This app was built and is maintained almost
entirely by AI agents. That changes how you should work:

- **Do the work, don't hand her instructions.** You have the tools to act. The Vercel CLI
  is installed and authenticated, the Supabase MCP is configured, and you can run SQL and
  deploy directly. Never end a turn with "now run these commands" if you could have run them
  yourself. Making her copy-paste terminal commands is what used to frustrate her.
- **Explain in plain language, briefly.** Say what you did and what it means for her
  business, not how the internals work. No walls of jargon.
- **Prefer safe, reversible steps, and say when something isn't reversible.** Before anything
  that could log users out, change a password, touch payments, or delete data, tell her
  plainly and confirm.
- **Never reintroduce the old stack.** This app was migrated off SQLite / Railway / Netlify
  on 2026-07-12. If you see those mentioned in an old file or comment, it is stale. Postgres
  on Supabase, hosted on Vercel, is the truth.
- **Deploy by committing and pushing to `main`.** The Vercel project is git-connected, so a
  push to GitHub `main` auto-deploys to production (bgmoffice.com). Commit your change and
  `git push` — that push *is* the deploy. Git is the source of truth; don't let prod get ahead
  of it. (`vercel --prod` still works as an emergency fallback when you truly can't push, but
  it leaves git behind, so avoid it — push instead.)
- **There is a human backstop.** Sarede's friend Yidy helps with the hard/credentialed parts
  (DNS, billing, accounts). If something needs a login only she has, say so clearly and stop.

## Current state & open items (as of 2026-07-12)

The migration is complete and the app is live and working at https://bgmoffice.vercel.app.
Login works against real data. A full review lives in `ROADMAP.md` — read it before making
architectural changes.

Security done:
- Row Level Security is now ENABLED on all tables (the DB was previously reachable through
  Supabase's public REST API). Do not disable it. The app connects as the `postgres` owner,
  which bypasses RLS, so RLS being on does not affect the app.
- `JWT_SECRET` was rotated on 2026-07-12 (the old one had leaked into git history).

Still open (see ROADMAP.md for detail):
- **DNS**: `bgmoffice.com` may still point at the old Netlify host. The live app is on Vercel.
  Changing this needs the owner's Porkbun login — a human task.
- **Default admin password** `admin@bgmoffice.com` / `admin123` is still live. Should be
  changed, but only with the owner present so she isn't locked out.
- **Stripe webhook** skips signature verification when no secret is set — should be made to
  require `STRIPE_WEBHOOK_SECRET`.
- **Data model**: `*_at` columns are stored as TEXT and booleans as integers (SQLite
  leftovers). Fix before the dataset grows. Details in ROADMAP.md Phase 2.
- No automated tests, CI, or error monitoring yet.

## Stack

- Frontend — React 19, Vite, Tailwind CSS v4, React Router v7
- Backend — Node.js, Express 5, deployed as a single Vercel serverless function
- Database — PostgreSQL on Supabase, accessed with the `pg` driver (raw SQL)
- Auth — custom JWT (bcryptjs + jsonwebtoken), 8h tokens. NOT Supabase Auth.
- Payments — Stripe (PaymentIntents + webhooks)
- Hosting — Vercel (frontend + API). Supabase hosts only the database.

Migrated off SQLite/Railway/Netlify on 2026-07-12. If you find a doc, config file, or comment
that mentions SQLite, `better-sqlite3`, Railway, or Netlify, it is stale — the truth is above.

## Project structure

```
bgmoffice/
├── api/index.js               # Vercel entry — just re-exports server/app.js
├── client/src/
│   ├── api/client.js          # single API wrapper — all fetch calls go here
│   ├── context/AuthContext.jsx
│   ├── components/            # shared UI components
│   └── pages/                 # one file per route
└── server/
    ├── app.js                 # Express app + all route registration
    ├── index.js               # local dev only: app.listen()
    ├── middleware/auth.js     # requireAuth / requireAdmin
    ├── routes/                # one file per resource
    └── db/pg.js               # the Postgres pool — the ONLY db module
```

Note the split: `app.js` builds the app, `index.js` listens. Vercel imports `app.js` directly
(a serverless function must not call `listen()`), so **routes are registered in `app.js`**.

## Database access

`server/db/pg.js` exports a `pg` connection Pool. Every route does:

```js
const pool = require('../db/pg');

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  res.json(rows);
});
```

Rules:
- Postgres placeholders are `$1, $2` — NOT `?`.
- Every db call is **async** — always `await pool.query(...)`, and route handlers are `async`.
- `pool.query()` returns `{ rows }`. Destructure it; the rows are not the return value.

## Schema changes

There is no auto-migration on startup any more. The schema lives in Supabase, and you change it
by running SQL against the Supabase project directly (project ref `fzaknqlbtjyepntfztgk`) — via
the Supabase MCP, the SQL editor in the dashboard, or `psql` with `DATABASE_URL`.

Apply the schema change first, then ship the code that depends on it. When you create a new
table, immediately `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on it (see Security above).

## Running locally

```bash
npm install
npm run dev      # server on :3001, client on :5173
```

Local dev talks to the **live Supabase database** — there is no local database any more. Be
careful: a destructive query on your laptop hits production data.

`server/.env` holds the local secrets (gitignored). `DATABASE_URL` is the important one.

## Environment variables

Set in the Vercel dashboard (or `vercel env add`), and mirrored in `server/.env` for local dev:

- `DATABASE_URL` — Supabase transaction-pooler connection string. Without this the app cannot
  reach the database at all. This is the one that is easy to forget.
- `JWT_SECRET` — signs auth tokens
- `ALLOWED_ORIGIN` — CORS origin
- `SUPABASE_URL` — used by the `/uploads` proxy to Supabase Storage
- `GOOGLE_FORMS_WEBHOOK_SECRET` — guards the recruiting intake webhook
- `STRIPE_SECRET_KEY` — optional; the app prefers the key stored in the `app_settings` table
  and only falls back to this env var

After adding or changing a variable in Vercel you must **redeploy** — Vercel bakes env vars in
at build time, so a change alone does nothing.

## Deploying

The Vercel project is **git-connected** — pushing to GitHub `main` auto-deploys to production
(bgmoffice.com). So shipping is just:

```bash
git add -A && git commit -m "…" && git push origin main   # auto-deploys to prod
```

Run the DB migration first if the change adds one: `node server/db/migrate.js` (safe to re-run).
`vercel logs <url>` for runtime errors. `vercel --prod` is an emergency-only fallback (it ships
without a push and leaves git behind — prefer pushing so version control stays the truth).

## Auth flow

1. `POST /api/auth/login` → returns JWT (rate-limited: 10 req / 15 min per IP)
2. Token stored in `localStorage` as `bgm_token`
3. All API calls attach `Authorization: Bearer <token>`
4. On 401, `api/client.js` fires a `bgm:session-expired` event → `AuthContext` clears the user
   → login page shown

## API conventions

- All routes under `/api/*` require `requireAuth`, except `/api/auth/login`,
  `/api/invoices/public/*`, and `/api/settings/stripe-public`
- `requireAdmin` is for settings and user-management routes only
- Route files export an Express router, registered in `server/app.js`
- `vercel.json` rewrites every `/api/*` request to the single `api/index` function

## Frontend conventions

- `client/src/api/client.js` is the only place that calls `fetch` — add new endpoints there,
  never inline in a component
- Forms use controlled state with individual `useState` hooks (no form libraries)
- Date inputs use the custom `<DateInput>` component (three dropdowns: month/day/year) — do not
  use `<input type="date">` directly
- Tailwind v4 — utility classes only, no `tailwind.config.js`

## Backups

Handled by Supabase (managed, automatic). The old SQLite backup cron was deleted with the
migration — do not reintroduce it.

## Related

- `ROADMAP.md` — full code review and prioritized improvement plan. Read before big changes.
- Sarede also runs a personal assistant called "Amber" (in a separate repo) that logs into
  this app's API. If you change the auth flow or the login endpoint, Amber may need updating.
