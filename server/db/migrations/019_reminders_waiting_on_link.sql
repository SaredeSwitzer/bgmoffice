-- 019 — links a reminder back to the "Waiting to Hear Back From" item that spawned it,
-- so the nightly sync (server/lib/dailySync.js syncWaitingOnReminders) doesn't create a
-- duplicate reminder every night once one already exists for an overdue item, and so
-- resolving/rescheduling the item can find and clean up its own reminder.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS waiting_on_id BIGINT REFERENCES waiting_on_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS reminders_waiting_on_idx ON reminders (waiting_on_id);
