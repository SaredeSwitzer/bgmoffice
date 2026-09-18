-- Classes that several people share the cost of.
--
-- Baila Gutman's Tuesday class is $105, and Baila, Chaya Rosner and a third woman split
-- it between them. Until now the app could not say that: a class belongs to exactly one
-- client, everywhere — the class row, the weekly charge, the receipt. The workaround was
-- to type "CC-divide" into the payment method as a note-to-self and then work the split
-- out by hand. Nothing read that note; two classes still carry it.
--
-- So: a list of who shares a class. The money is unchanged — a $105 class is still $105
-- of revenue and the instructor is still paid once. It is only *collected* from several
-- cards instead of one.
--
-- The list hangs off the recurring class, not off each week's session, and is resolved at
-- billing time rather than copied onto sessions as they are generated. That is deliberate:
-- copying is what caused the schedule/calendar drift that has bitten this app three times
-- (see the reconcile tool on the Schedule page). Nothing to drift if nothing is copied.
--
-- A session-level list overrides the class-level one for that one week, which is how a
-- person joining late, or skipping a week, is handled without disturbing the others.

CREATE TABLE IF NOT EXISTS class_payers (
  id          BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT REFERENCES class_schedules(id) ON DELETE CASCADE,
  session_id  BIGINT REFERENCES class_sessions(id)  ON DELETE CASCADE,
  client_id   BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one of the two: a row is either the standing list for a recurring class or
  -- the override for a single week. Both, or neither, has no meaning.
  CONSTRAINT class_payers_one_target CHECK (
    (schedule_id IS NOT NULL AND session_id IS NULL) OR
    (schedule_id IS NULL AND session_id IS NOT NULL)
  )
);

-- Naming the same person twice would halve everyone else's share for no reason.
CREATE UNIQUE INDEX IF NOT EXISTS class_payers_schedule_client
  ON class_payers (schedule_id, client_id) WHERE schedule_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS class_payers_session_client
  ON class_payers (session_id, client_id)  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS class_payers_client ON class_payers (client_id);

-- RLS in the same breath as the CREATE. A table made outside the migration path once went
-- live without it and left every text the business had sent readable, and writable, with
-- the anon key that ships in browsers. See the Security section of CLAUDE.md.
ALTER TABLE class_payers ENABLE ROW LEVEL SECURITY;

-- ── Who owes what for each class ──────────────────────────────────────────────
--
-- One row per session per payer. A class nobody shares yields exactly one row — the
-- client, the full amount — so every caller can read this view instead of class_sessions
-- and get the same answer it got before.
--
-- The odd penny goes to the first person on the list rather than being rounded away:
-- three ways on $100 is 33.34 / 33.33 / 33.33, which collects $100. Rounding each share
-- independently would collect $99.99 and quietly lose a cent a week for ever.
CREATE OR REPLACE VIEW session_payer_shares AS
WITH resolved AS (
  SELECT s.id AS session_id, s.schedule_id, s.session_date, s.start_time,
         s.instructor_id, s.style, s.payment_method, s.status,
         COALESCE(s.charge_amount, 0) AS charge_amount,
         s.client_id AS class_client_id,
         COALESCE(
           -- this week's override, if one was set
           (SELECT array_agg(p.client_id ORDER BY p.id)
              FROM class_payers p WHERE p.session_id = s.id),
           -- otherwise the standing list for the recurring class
           (SELECT array_agg(p.client_id ORDER BY p.id)
              FROM class_payers p WHERE p.schedule_id = s.schedule_id),
           -- otherwise it is simply their class
           ARRAY[s.client_id]
         ) AS payers
    FROM class_sessions s
)
SELECT r.session_id, r.schedule_id, r.session_date, r.start_time,
       r.instructor_id, r.style, r.payment_method, r.status,
       r.class_client_id,
       r.charge_amount AS session_amount,
       array_length(r.payers, 1) AS payer_count,
       u.client_id,
       (round(r.charge_amount / array_length(r.payers, 1), 2)
         + CASE WHEN u.ord = 1
                THEN r.charge_amount
                     - round(r.charge_amount / array_length(r.payers, 1), 2)
                       * array_length(r.payers, 1)
                ELSE 0 END)::numeric(10,2) AS amount
  FROM resolved r,
       unnest(r.payers) WITH ORDINALITY AS u(client_id, ord);
