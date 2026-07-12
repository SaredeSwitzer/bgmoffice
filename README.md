# bgmoffice

Internal operations app for managing private fitness/wellness instructors and clients.

## Structure

```
bgmoffice/
├── api/        Vercel serverless entry (re-exports the Express app)
├── client/     React + Tailwind + React Router frontend
└── server/     Node.js + Express API, PostgreSQL (Supabase)
```

## Quick Start

```bash
npm install
npm run dev
```

- Server: http://localhost:3001
- Client: http://localhost:5173

Copy `server/.env.example` to `server/.env` and fill it in first. `DATABASE_URL` (the Supabase
connection string) is required — there is no local database, so local dev talks to the live
Supabase Postgres.

## Tech Stack

- Frontend: React 19, Vite, Tailwind CSS v4, React Router v7
- Backend: Node.js, Express 5, deployed as a single Vercel serverless function
- Database: PostgreSQL on Supabase, via the `pg` driver (raw SQL)
- Auth: bcryptjs + JWT, stored in localStorage
- Payments: Stripe
- Hosting: Vercel

## Deploying

```bash
vercel --prod
```

## Notes

Migrated from SQLite/Railway/Netlify to PostgreSQL/Supabase/Vercel on 2026-07-12.
See `CLAUDE.md` for conventions and environment variables.
