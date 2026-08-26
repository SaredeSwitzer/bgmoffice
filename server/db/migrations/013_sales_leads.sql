-- 013 — Sarede's private sales-call tracker: a lead list, each optionally linked to an
-- existing client record, each with its own running note thread (same follow_up_notes/
-- reminder_notes shape). Sarede-only feature — see server/middleware/auth.js
-- requireSaredeOnly — not staff-wide.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS sales_leads (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  client_id    BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_lead_notes (
  id              BIGSERIAL PRIMARY KEY,
  sales_lead_id   BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  author_initials TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_lead_notes_lead_idx ON sales_lead_notes (sales_lead_id, created_at);

ALTER TABLE sales_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lead_notes  ENABLE ROW LEVEL SECURITY;
