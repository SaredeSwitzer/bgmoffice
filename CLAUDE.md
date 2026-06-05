# BGM Office — Claude Code Guide

Internal operations app for a private fitness/wellness business. Manages clients, instructors, cases, invoices, scheduling, and recruiting.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, React Router v7 |
| Backend | Node.js, Express 5, better-sqlite3 |
| Auth | Custom JWT (bcryptjs + jsonwebtoken) — 8h tokens |
| Payments | Stripe (PaymentIntents + webhooks) |
| Hosting | Netlify (frontend) + Railway (backend + SQLite volume) |

## Project structure

```
bgmoffice/
├── client/src/
│   ├── api/client.js          # single API wrapper — all fetch calls go here
│   ├── context/AuthContext.jsx
│   ├── components/            # shared UI components
│   └── pages/                 # one file per route
└── server/
    ├── index.js               # Express app + startup (backup, CORS, routes)
    ├── middleware/auth.js      # requireAuth / requireAdmin
    ├── routes/                # one file per resource
    └── db/
        ├── index.js           # DB singleton + all migrations (run on every boot)
        ├── schema.sql         # base schema (source of truth for new installs)
        ├── backup.js          # SQLite backup utility (runs at startup + daily)
        └── backups/           # local backup files (gitignored)
```

## Running locally

```bash
# From repo root — starts both server and client concurrently
npm install
npm run dev
```

- Server: http://localhost:3001
- Client: http://localhost:5173

First run: `cd server && npm run seed` to create the database with sample data.

Copy `server/.env.example` → `server/.env` and fill in values before starting.

## Default dev credentials

| Role  | Email               | Password  |
|-------|---------------------|-----------|
| Admin | admin@bgmoffice.com | admin123  |
| Staff | lyra@bgmoffice.com  | staff123  |

## Environment variables

All secrets live in `server/.env` (gitignored). See `server/.env.example` for all required keys.

On Railway: set `NODE_ENV=production` and all vars via the Railway dashboard. The DB path and uploads path are hardcoded to `/app/server/data/` in production — do not change without updating `db/index.js` and `index.js`.

## Database migrations

Migrations run automatically at server startup inside `server/db/index.js`. The pattern is:

```js
// Safe to run repeatedly — "duplicate column" errors are silently swallowed
db.exec(`ALTER TABLE foo ADD COLUMN bar TEXT`)
```

Add new `ALTER TABLE` statements to the `migrations` array at the bottom of `db/index.js`. Never edit `schema.sql` for columns added post-deploy — schema.sql is only for fresh installs.

## Auth flow

1. `POST /api/auth/login` → returns JWT (rate-limited: 10 req / 15 min per IP)
2. Token stored in `localStorage` as `bgm_token`
3. All API calls attach `Authorization: Bearer <token>`
4. On 401, `api/client.js` fires `bgm:session-expired` event → `AuthContext` clears user → login page shown

## API conventions

- All routes under `/api/*` require `requireAuth` except `/api/auth/login`, `/api/invoices/public/*`, and `/api/settings/stripe-public`
- `requireAdmin` is for settings/user-management routes only
- Route files export an Express router; registered in `server/index.js`
- SQLite calls use `better-sqlite3` synchronous API (no async/await in route handlers)

## Frontend conventions

- `client/src/api/client.js` is the only place that calls `fetch` — add new endpoints there, not inline in components
- Forms use controlled state with individual `useState` hooks (no form libraries)
- Date inputs use the custom `<DateInput>` component (three dropdowns: month/day/year) — do not use `<input type="date">` directly
- Tailwind v4 — utility classes only, no `tailwind.config.js`

## Backup

SQLite backups run automatically on server startup and every 24 hours. To run manually:

```bash
node server/db/backup.js
```

Backups kept for 7 days, stored in `server/db/backups/` (local) or `/app/server/data/backups/` (Railway).

## Future migration

A full migration plan to Vercel + Supabase (PostgreSQL, Supabase Auth, Supabase Storage) is documented in `MIGRATION_PLAN.md`.
