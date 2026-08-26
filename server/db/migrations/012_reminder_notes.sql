-- 012 — A note thread on a reminder, separate from its own single `notes` field, so staff
-- can log what happened while working a due reminder ("tried to call, no answer") and
-- @mention a teammate about it, same pattern as follow_up_notes on action items.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS reminder_notes (
  id              BIGSERIAL PRIMARY KEY,
  reminder_id     BIGINT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  author_initials TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminder_notes_reminder_idx ON reminder_notes (reminder_id, created_at);

ALTER TABLE reminder_notes ENABLE ROW LEVEL SECURITY;
