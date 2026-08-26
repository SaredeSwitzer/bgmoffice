-- 014 — Public opt-in signups from instructors hearing about the new bgmoffice.com system
-- (e.g. a site-wide email to everyone in Shiftboard). Submitted via /join, no login
-- required; staff review and approve/reject each one. Approving creates a real
-- `instructors` row (+ login, via the same path as manually adding an instructor).
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS instructor_signups (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  neighborhood   TEXT,
  styles_taught  TEXT,
  specialties    TEXT,
  notes          TEXT,          -- free text from the submitter ("anything else we should know")
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  instructor_id  BIGINT REFERENCES instructors(id) ON DELETE SET NULL,  -- set once approved
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instructor_signups_status_idx ON instructor_signups (status, created_at);

ALTER TABLE instructor_signups ENABLE ROW LEVEL SECURITY;
