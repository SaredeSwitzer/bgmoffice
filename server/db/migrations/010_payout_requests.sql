-- 010 — Intent-only tracking of an instructor clicking "Send Payout Request" (Venmo deep
-- link). This does NOT confirm Venmo actually received/sent anything — there's no webhook
-- or callback from a plain deep link. It exists so the instructor-facing UI can show
-- "Requested ✓" for the week, and later so staff could see who hasn't requested. Distinct
-- from instructor_payments (server/routes/billing.js), which is staff's own paid/unpaid
-- bookkeeping done after the fact.
-- Run with: node server/db/migrate.js   (safe to run more than once)

CREATE TABLE IF NOT EXISTS payout_requests (
  id             BIGSERIAL PRIMARY KEY,
  instructor_id  BIGINT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  week_start     DATE   NOT NULL,  -- Sunday of the week being requested
  amount         NUMERIC(10,2) NOT NULL,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instructor_id, week_start)
);

CREATE INDEX IF NOT EXISTS payout_requests_instructor_idx ON payout_requests (instructor_id, week_start);

ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;
