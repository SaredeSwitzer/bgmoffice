-- 011 — Tracks an instructor confirming "my availability is still accurate" for a given
-- week, so the weekly nudge (paired with the Venmo payout-request nudge) can stop asking
-- once they've responded, the same way payout_requests tracks a payout request per week.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS availability_confirmations (
  id             BIGSERIAL PRIMARY KEY,
  instructor_id  BIGINT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  week_start     DATE   NOT NULL,  -- Sunday of the week being confirmed
  confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, week_start)
);

CREATE INDEX IF NOT EXISTS availability_confirmations_instructor_idx ON availability_confirmations (instructor_id, week_start);

ALTER TABLE availability_confirmations ENABLE ROW LEVEL SECURITY;
