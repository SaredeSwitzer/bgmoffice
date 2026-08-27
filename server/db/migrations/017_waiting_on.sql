-- 017 — "Waiting to Hear Back From" tracker: a shared, staff-wide list (unlike the
-- Sarede-only sales_leads) of clients/instructors (or people not yet in the system) that
-- staff are waiting on a reply from, each with a quick "what we're waiting on" note and
-- its own running note thread (same shape as sales_lead_notes/reminder_notes) so staff can
-- @mention a teammate to follow up ("can you call them again @Claire"). Shown as a sub-tab
-- on the Clients and Instructors pages, and on the linked client's/instructor's own profile.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS waiting_on_items (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('client', 'instructor')),
  name          TEXT NOT NULL,
  client_id     BIGINT REFERENCES clients(id) ON DELETE SET NULL,
  instructor_id BIGINT REFERENCES instructors(id) ON DELETE SET NULL,
  what          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by    TEXT,
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waiting_on_notes (
  id              BIGSERIAL PRIMARY KEY,
  waiting_on_id   BIGINT NOT NULL REFERENCES waiting_on_items(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  author_initials TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waiting_on_items_client_idx     ON waiting_on_items (client_id);
CREATE INDEX IF NOT EXISTS waiting_on_items_instructor_idx ON waiting_on_items (instructor_id);
CREATE INDEX IF NOT EXISTS waiting_on_items_kind_status_idx ON waiting_on_items (kind, status);
CREATE INDEX IF NOT EXISTS waiting_on_notes_item_idx ON waiting_on_notes (waiting_on_id, created_at);

ALTER TABLE waiting_on_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_on_notes ENABLE ROW LEVEL SECURITY;
