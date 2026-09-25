-- Splitting a class between cards, not just between people.
--
-- Migration 033 let a class be shared by several clients, each charged on their own
-- default card. Then the third woman in Baila Gutman's Tuesday class had her card saved
-- onto *Baila's* file ("3rd Person's Card", Visa 7313) — and there was no way to charge
-- it: a share pointed at a person, and a person meant their default card.
--
-- So a share can now name a card. NULL still means "that person's default card", which
-- is every share that existed before this and every share where nobody picked one. The
-- same person may therefore appear twice — once per card — which the old unique index
-- forbade.

ALTER TABLE class_payers
  ADD COLUMN IF NOT EXISTS card_id BIGINT REFERENCES client_cards(id) ON DELETE SET NULL;

-- One row per (person, card). NULLs are distinct in a unique index, so if a named card is
-- removed and its share falls back to the default, the row is kept rather than the card
-- removal failing — the share is then charged on the default card, and the money is
-- still collected in full. Losing the row instead would quietly re-split the class and
-- overcharge everyone else.
DROP INDEX IF EXISTS class_payers_schedule_client;
DROP INDEX IF EXISTS class_payers_session_client;
CREATE UNIQUE INDEX IF NOT EXISTS class_payers_schedule_client_card
  ON class_payers (schedule_id, client_id, card_id) WHERE schedule_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS class_payers_session_client_card
  ON class_payers (session_id, client_id, card_id)  WHERE session_id IS NOT NULL;

-- A week's charge is now per card, not per client: Baila's file is charged twice a week,
-- once on each card. No foreign key on purpose — this is a record of what was charged,
-- and it must outlive the card being removed from the file.
ALTER TABLE recurring_charges
  ADD COLUMN IF NOT EXISTS card_id BIGINT,
  ADD COLUMN IF NOT EXISTS card_last4 TEXT;

DROP INDEX IF EXISTS recurring_charges_client_week_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS recurring_charges_client_week_card_uidx
  ON recurring_charges (client_id, week_start, (COALESCE(card_id, 0)));

-- The view gains card_id (appended — CREATE OR REPLACE VIEW can only add columns at the
-- end). Same fallback chain as before: this week's override → the recurring class's list
-- → just the client. The odd penny still goes to the first row on the list.
CREATE OR REPLACE VIEW session_payer_shares AS
WITH resolved AS (
  SELECT s.id AS session_id, s.schedule_id, s.session_date, s.start_time,
         s.instructor_id, s.style, s.payment_method, s.status,
         COALESCE(s.charge_amount, 0) AS charge_amount,
         s.client_id AS class_client_id,
         COALESCE(
           (SELECT array_agg(p.id ORDER BY p.id)
              FROM class_payers p WHERE p.session_id = s.id),
           (SELECT array_agg(p.id ORDER BY p.id)
              FROM class_payers p WHERE p.schedule_id = s.schedule_id)
         ) AS payer_rows
    FROM class_sessions s
),
expanded AS (
  -- A shared class: one row per entry on its list.
  SELECT r.*, array_length(r.payer_rows, 1) AS n, u.ord, p.client_id, p.card_id
    FROM resolved r
    CROSS JOIN LATERAL unnest(r.payer_rows) WITH ORDINALITY AS u(payer_id, ord)
    JOIN class_payers p ON p.id = u.payer_id
   WHERE r.payer_rows IS NOT NULL
  UNION ALL
  -- Everything else: the client pays for their own class, on their default card.
  SELECT r.*, 1, 1, r.class_client_id, NULL::bigint
    FROM resolved r
   WHERE r.payer_rows IS NULL
)
SELECT e.session_id, e.schedule_id, e.session_date, e.start_time,
       e.instructor_id, e.style, e.payment_method, e.status,
       e.class_client_id,
       e.charge_amount AS session_amount,
       e.n AS payer_count,
       e.client_id,
       (round(e.charge_amount / e.n, 2)
         + CASE WHEN e.ord = 1
                THEN e.charge_amount - round(e.charge_amount / e.n, 2) * e.n
                ELSE 0 END)::numeric(10,2) AS amount,
       e.card_id
  FROM expanded e;
