-- 012 — Admin-only notes on classes
-- Same idea as class_notes (005), but a separate, more restricted table: only Sarede,
-- Claire, and Maria can see or write these (enforced in server/middleware/auth.js's
-- requireOwnerAccess), not every staff/admin login. Plain notes only — no task/checkbox
-- shape, unlike class_notes.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS admin_notes (
  id           BIGSERIAL PRIMARY KEY,
  schedule_id  BIGINT REFERENCES class_schedules(id) ON DELETE CASCADE,
  session_id   BIGINT REFERENCES class_sessions(id)  ON DELETE CASCADE,
  text         TEXT    NOT NULL,
  author       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- exactly one parent: a note belongs to a recurring class OR a dated session, never both.
  CONSTRAINT admin_notes_one_parent CHECK (
    (schedule_id IS NOT NULL AND session_id IS NULL) OR
    (schedule_id IS NULL AND session_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS admin_notes_schedule_idx ON admin_notes (schedule_id);
CREATE INDEX IF NOT EXISTS admin_notes_session_idx  ON admin_notes (session_id);

ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
