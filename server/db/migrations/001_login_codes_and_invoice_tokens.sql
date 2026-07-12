-- 001 — Email-code login + unguessable public invoice links
-- Run with: node server/db/migrate.js   (safe to run more than once)

-- ── Email-code login ─────────────────────────────────────────────────────────
-- Users log in with a 6-digit code instead of a password. `login_email` is where
-- that code is DELIVERED: the @bgmoffice.com addresses in `email` are login names,
-- not real mailboxes (bgmoffice.com only has Porkbun forwarding), so the code must
-- go to a real address. A user may sign in with either their `email` or `login_email`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_email TEXT;

CREATE TABLE IF NOT EXISTS login_codes (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_codes_user_created_idx ON login_codes (user_id, created_at DESC);

-- The app connects as the `postgres` owner (bypasses RLS), but RLS-on keeps the
-- table invisible to Supabase's public REST API, same as every other table here.
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;

-- ── Unguessable public invoice links ─────────────────────────────────────────
-- The pay page was /pay/<sequential id>, so anyone could walk 1,2,3… and read every
-- invoice (client name, email, line items) with no login. Look them up by a random
-- token instead. Backfilled in migrate.js.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_idx ON invoices (public_token);
