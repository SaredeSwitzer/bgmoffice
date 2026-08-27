-- 015 — Instructors had `state` and `neighborhood` but no `city`. Adding it alongside
-- both, on the instructor record itself and on the /join sign-up form that feeds it.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE instructors        ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE instructor_signups ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE instructor_signups ADD COLUMN IF NOT EXISTS state TEXT;
