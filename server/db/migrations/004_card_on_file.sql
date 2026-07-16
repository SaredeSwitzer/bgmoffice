-- 004 — Card on file + recurring weekly CC charges (replaces USAePay recurring billing)
-- Run with: node server/db/migrate.js   (safe to run more than once)

-- ── Card on file, per client ──────────────────────────────────────────────────
-- A saved Stripe card so the weekly run can charge off-session. pay_token backs an
-- unguessable "save your card" link the client opens once (same idea as invoice
-- public_token). We store ONLY brand + last4 for display — never the card itself.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS card_brand         TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS card_last4         TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS card_saved_at      TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pay_token          TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clients_pay_token_idx ON clients (pay_token);

-- ── Weekly charge log ─────────────────────────────────────────────────────────
-- One row per client per week that got charged (or attempted). The unique index on
-- (client_id, week_start) is the guard against ever double-charging a client for the
-- same week — the charge endpoint uses ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS recurring_charges (
  id                       BIGSERIAL PRIMARY KEY,
  client_id                BIGINT      NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start               DATE        NOT NULL,
  amount                   NUMERIC(10,2) NOT NULL,
  session_count            INTEGER,
  stripe_payment_intent_id TEXT,
  status                   TEXT        NOT NULL,          -- charged | failed
  error                    TEXT,
  charged_by               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recurring_charges_client_week_uidx
  ON recurring_charges (client_id, week_start);
CREATE INDEX IF NOT EXISTS recurring_charges_week_idx ON recurring_charges (week_start);

-- RLS on (app connects as the postgres owner, bypasses it) — keeps the table out of
-- Supabase's public REST, same convention as every other table here.
ALTER TABLE recurring_charges ENABLE ROW LEVEL SECURITY;
