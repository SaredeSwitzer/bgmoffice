# BGM Office — Claude Code Guide

Internal operations app for a private fitness/wellness business. Manages clients, instructors,
cases, invoices, scheduling, and recruiting.

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

Apply the schema change first, then ship the code that depends on it.

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
- `SUPABASE_URL` — currently unused by the server; kept for future use
- `GOOGLE_FORMS_WEBHOOK_SECRET` — guards the recruiting intake webhook
- `STRIPE_SECRET_KEY` — optional; the app prefers the key stored in the `app_settings` table
  and only falls back to this env var

After adding or changing a variable in Vercel you must **redeploy** — Vercel bakes env vars in
at build time, so a change alone does nothing.

## Deploying

```bash
vercel --prod     # from the repo root; the project is already linked
```

The Vercel CLI is installed and authenticated, so an agent can deploy without asking the user
to do anything. `vercel logs <url>` for runtime errors.

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

Handled by Supabase (managed, automatic). The old `server/db/backup.js` cron was deleted with
the SQLite migration — do not reintroduce it.

## Known issues

- The admin login is still `admin@bgmoffice.com` / `admin123` on a live, public app. Change it.
- `bgmoffice.com` DNS (at Porkbun) may still point at Netlify. The live app is on Vercel.
