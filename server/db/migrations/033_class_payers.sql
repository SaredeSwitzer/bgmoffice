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

-- The unique indexes (one row per person, per card) live in 036, which replaced the
-- one-row-per-person indexes that were here: 036 lets the same person appear once per card.

CREATE INDEX IF NOT EXISTS class_payers_client ON class_payers (client_id);

-- RLS in the same breath as the CREATE. A table made outside the migration path once went
-- live without it and left every text the business had sent readable, and writable, with
-- the anon key that ships in browsers. See the Security section of CLAUDE.md.
ALTER TABLE class_payers ENABLE ROW LEVEL SECURITY;

-- ── Who owes what for each class ──────────────────────────────────────────────
--
-- The session_payer_shares view that was defined here now lives in 036, which added the
-- card each share is charged on. It cannot stay here too: every migration is re-run in
-- order, and redefining the view without its card_id column would fail ("cannot drop
-- columns from view").
