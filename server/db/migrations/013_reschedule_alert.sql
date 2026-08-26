-- 013 — Reschedule alert tracking
-- Lets staff send a one-off "your class time/date changed" email to the instructor after
-- a session's date or time is edited (e.g. via drag-and-drop on the Schedule week view),
-- separate from the initial confirmation_sent_at/to pair. Same shape, own columns, so
-- "confirmed" and "notified of a later change" are tracked independently.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE class_sessions
  ADD COLUMN IF NOT EXISTS reschedule_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_alert_sent_to TEXT;
