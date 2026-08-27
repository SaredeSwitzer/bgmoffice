-- 018 — optional "need to hear back by" date on a Waiting to Hear Back From item, so a
-- deadline-sensitive one (e.g. a class that needs enough sign-ups by a certain date) can
-- be flagged and shown as overdue once that date passes.
-- Run with: node server/db/migrate.js   (safe to run more than once)

ALTER TABLE waiting_on_items ADD COLUMN IF NOT EXISTS need_by DATE;
