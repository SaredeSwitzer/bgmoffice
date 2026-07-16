-- 005 — Notes & tasks on classes
-- A lightweight notes/checklist attached to EITHER a recurring class (class_schedules)
-- or a single dated session (class_sessions). Each item is a plain note, or a task that
-- can be checked off. Same idea as instructor_notes / recruiting_notes, kept self-contained
-- (no standalone-task linkage) since class reminders live and die with the class.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS class_notes (
  id           BIGSERIAL PRIMARY KEY,
  schedule_id  BIGINT REFERENCES class_schedules(id) ON DELETE CASCADE,
  session_id   BIGINT REFERENCES class_sessions(id)  ON DELETE CASCADE,
  text         TEXT    NOT NULL,
  is_task      BOOLEAN NOT NULL DEFAULT false,
  is_done      BOOLEAN NOT NULL DEFAULT false,
  done_at      TIMESTAMPTZ,
  author       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- exactly one parent: a note belongs to a recurring class OR a dated session, never both.
  CONSTRAINT class_notes_one_parent CHECK (
    (schedule_id IS NOT NULL AND session_id IS NULL) OR
    (schedule_id IS NULL AND session_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS class_notes_schedule_idx ON class_notes (schedule_id);
CREATE INDEX IF NOT EXISTS class_notes_session_idx  ON class_notes (session_id);

-- RLS on (app connects as the postgres owner, bypasses it) — keeps the table out of
-- Supabase's public REST, same convention as every other table here.
ALTER TABLE class_notes ENABLE ROW LEVEL SECURITY;
