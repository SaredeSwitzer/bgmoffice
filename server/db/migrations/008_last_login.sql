-- 008 — Track last login so staff can see who has (and hasn't) actually signed in.
-- Motivated by the instructor portal rollout: staff want to know which instructors
-- have logged in / set up their profile, and follow up with the ones who haven't.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
