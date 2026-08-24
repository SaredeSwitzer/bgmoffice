-- 011 — Client-level class defaults (age, participant count, style)
-- Lets staff set a typical age range, participant count, and class style once on a
-- client's profile, so new calendar entries (class_schedules/class_sessions) for that
-- client pre-fill from it instead of being re-typed every time — and so the instructor
-- confirmation email ({participants}/{ages}/{style}) has something to show even when
-- staff didn't fill those in on the individual class. Run: node server/db/migrate.js (re-runnable)

ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_age TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_participants INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_style TEXT;
