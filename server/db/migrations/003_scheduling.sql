-- 003 — Class scheduling (the Shiftboard replacement)
-- Two tables: recurring class arrangements, and their dated occurrences. The
-- occurrences are what replace Shiftboard's "Weekly Classes" report that Amber
-- pulls each week to drive billing and reminders.
-- Run with: node server/db/migrate.js   (safe to run more than once)

-- ── Recurring class arrangements (the standing weekly class) ──────────────────
CREATE TABLE IF NOT EXISTS class_schedules (
  id                   BIGSERIAL PRIMARY KEY,
  client_id            BIGINT      NOT NULL REFERENCES clients(id)     ON DELETE CASCADE,
  instructor_id        BIGINT               REFERENCES instructors(id) ON DELETE SET NULL,
  weekday              SMALLINT,                        -- 0=Sun … 6=Sat; NULL = flexible/unscheduled
  start_time           TIME,
  charge_amount        NUMERIC(10,2),                   -- billed to the client per class
  instructor_pay       NUMERIC(10,2),                   -- paid to the instructor per class
  payment_method       TEXT,                            -- 'Credit Card', 'Zelle', 'Check', 'Cash', …
  style                TEXT,
  location             TEXT,                            -- neighborhood / address note
  special_instructions TEXT,
  status               TEXT        NOT NULL DEFAULT 'active',   -- active | paused
  start_date           DATE,
  end_date             DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_schedules_client_idx ON class_schedules (client_id);
CREATE INDEX IF NOT EXISTS class_schedules_active_idx ON class_schedules (status, weekday);

-- RLS on (app connects as the postgres owner and bypasses it) keeps the table
-- invisible to Supabase's public REST API — same convention as every table here.
ALTER TABLE class_schedules ENABLE ROW LEVEL SECURITY;

-- ── Dated class occurrences (what is booked / happened on a given day) ────────
CREATE TABLE IF NOT EXISTS class_sessions (
  id             BIGSERIAL PRIMARY KEY,
  schedule_id    BIGINT           REFERENCES class_schedules(id) ON DELETE SET NULL,  -- NULL = one-off
  client_id      BIGINT  NOT NULL REFERENCES clients(id)         ON DELETE CASCADE,
  instructor_id  BIGINT           REFERENCES instructors(id)     ON DELETE SET NULL,
  session_date   DATE    NOT NULL,
  start_time     TIME,
  charge_amount  NUMERIC(10,2),
  instructor_pay NUMERIC(10,2),
  payment_method TEXT,
  style          TEXT,
  status         TEXT    NOT NULL DEFAULT 'scheduled',  -- scheduled | completed | cancelled | no_show
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_sessions_date_idx       ON class_sessions (session_date);
CREATE INDEX IF NOT EXISTS class_sessions_client_idx     ON class_sessions (client_id);
CREATE INDEX IF NOT EXISTS class_sessions_instructor_idx ON class_sessions (instructor_id);

-- At most one generated occurrence per schedule per day, so "generate this week"
-- can be re-run without creating duplicates (ON CONFLICT DO NOTHING targets this).
CREATE UNIQUE INDEX IF NOT EXISTS class_sessions_sched_date_uidx
  ON class_sessions (schedule_id, session_date) WHERE schedule_id IS NOT NULL;

ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
