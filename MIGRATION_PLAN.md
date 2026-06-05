# BGM Office — Migration Plan: Railway/SQLite → Vercel + Supabase

## Why migrate?

| Pain point today | After migration |
|---|---|
| SQLite on a single Railway server — no auto-backups, can't scale | PostgreSQL on Supabase — managed, auto-backed-up, point-in-time recovery |
| Custom bcrypt + JWT auth | Supabase Auth — handles sessions, password reset, email verification |
| Uploaded files live on Railway volume (lost if container resets) | Supabase Storage — S3-backed, survives deploys |
| Railway charges ~$5–20/mo for always-on server | Vercel free tier + Supabase free tier — $0 to start |
| No realtime — have to refresh to see changes | Supabase Realtime — dashboards can update live |

---

## Target stack

- **Frontend**: Vercel (same Vite + React build, just different host)
- **Backend**: Vercel Serverless Functions (replaces Express routes, one file per route group)
- **Database**: Supabase PostgreSQL (replaces SQLite)
- **Auth**: Supabase Auth (replaces custom bcrypt + JWT)
- **File storage**: Supabase Storage (replaces `/uploads` on Railway volume)
- **Stripe**: unchanged — same keys, same webhook logic

---

## Migration phases

### Phase 1 — Set up Supabase (1–2 hours)

1. Create a Supabase project at supabase.com
2. Port the schema from `server/db/schema.sql` to Supabase SQL editor
   - SQLite → PostgreSQL differences to fix:
     - `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`
     - `TEXT` date columns → `TIMESTAMPTZ` where appropriate
     - `CHECK` constraints stay the same
     - `PRAGMA foreign_keys = ON` → Supabase has FK enforcement by default
3. Enable Row Level Security (RLS) on all tables
   - Start with a permissive policy for authenticated users: `USING (auth.role() = 'authenticated')`
   - Tighten per-table as needed (e.g. only admins can write to `users`)
4. Create Supabase Auth users to match existing `users` table entries
   - Use Supabase dashboard → Authentication → Users → "Invite user"
   - Store `supabase_uid` in your `users` table to link them

### Phase 2 — Migrate data (2–3 hours)

1. Export the current SQLite DB:
   ```bash
   node server/db/backup.js   # get a clean copy
   ```
2. Use a tool like `sqlite3` + `psql` or write a one-time migration script:
   ```js
   // scripts/migrate-to-supabase.js
   // 1. Open SQLite with better-sqlite3
   // 2. Read each table row by row
   // 3. INSERT into Supabase via supabase-js client
   ```
3. Migrate uploaded files from Railway volume to Supabase Storage:
   ```bash
   # Download all files from Railway volume
   # Upload to Supabase Storage bucket "bgm-uploads"
   supabase storage cp ./uploads/* supabase://bgm-uploads/
   ```
4. Verify row counts match between SQLite and Supabase

### Phase 3 — Rewrite the backend as Vercel API routes (3–5 days)

Each Express router file becomes a Vercel API route under `client/api/`:

```
server/routes/clients.js     → client/api/clients/[id].js + client/api/clients/index.js
server/routes/instructors.js → client/api/instructors/[id].js + ...
server/routes/cases.js       → client/api/cases/[id].js + ...
(etc.)
```

Each route file changes from:
```js
// Express (current)
router.get('/:id', requireAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id)
  res.json(client)
})
```
to:
```js
// Vercel serverless (new)
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  // Auth check via Supabase session token (replaces JWT middleware)
  const { data: { user } } = await supabase.auth.getUser(req.headers.authorization?.slice(7))
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await supabase.from('clients').select('*').eq('id', req.query.id).single()
  if (error) return res.status(404).json({ error: 'Not found' })
  res.json(data)
}
```

**Route groups to convert (in order of priority):**
1. Auth (`/api/auth`) — replace with Supabase Auth SDK calls on the frontend; most login/logout logic moves out of the backend entirely
2. Clients (`/api/clients`)
3. Instructors (`/api/instructors`) — includes file uploads → Supabase Storage
4. Cases + Action Items (`/api/cases`, `/api/action-items`)
5. Invoices + Stripe (`/api/invoices`) — webhook stays, just moves to Vercel
6. Reminders, Tasks, Packages, Dashboard, Reference, Recruiting, Settings

### Phase 4 — Update the frontend (1–2 days)

1. Replace `api.login()` / `api.me()` with Supabase Auth SDK:
   ```js
   import { createClient } from '@supabase/supabase-js'
   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
   await supabase.auth.signInWithPassword({ email, password })
   ```
2. Replace `localStorage.getItem('bgm_token')` with Supabase session management (it handles storage and refresh automatically — the JWT expiry bug goes away for free)
3. Replace `uploadsUrl()` with Supabase Storage public URLs
4. Update `VITE_API_URL` to point to Vercel (will be the same domain in production — `/api/...`)

### Phase 5 — Deploy and cut over (1 day)

1. Push to Vercel, set environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
2. Point Stripe webhook to new Vercel URL
3. Test all routes on the Vercel preview URL
4. Update DNS / Netlify → Vercel if using a custom domain
5. Shut down Railway service

---

## Things to watch out for

- **Supabase RLS**: Easy to accidentally block your own API routes. Test with `service_key` (bypasses RLS) first, then tighten with `anon_key` + policies.
- **Vercel function timeout**: Default is 10s on free tier. The Stripe webhook and any heavy queries need to stay fast.
- **File URL migration**: Any existing `instructor.photo_url` values in the DB point to the old Railway `/uploads/` path. Write a one-time script to update them to Supabase Storage URLs after migration.
- **SQLite `TEXT` dates**: Some date columns are stored as ISO strings. PostgreSQL will accept them as-is in `TEXT` columns, but if you use `TIMESTAMPTZ`, you need to parse them during migration.
- **bcrypt passwords**: Supabase Auth manages passwords separately — you cannot import bcrypt hashes into Supabase Auth. Users will need to reset passwords, or you can send them a "set your password" invite email via Supabase.

---

## Estimated total effort

| Phase | Time |
|---|---|
| Supabase setup + schema | 1–2 hours |
| Data migration | 2–3 hours |
| Backend rewrite | 3–5 days |
| Frontend updates | 1–2 days |
| Deploy + cutover | 1 day |
| **Total** | **~1 week of focused work** |

Start with Phase 1 and 2 (schema + data) before touching any code — once you know the data migrates cleanly, the code rewrite is lower risk.
