-- Several numbers per client, each saying what it is actually for.
--
-- Replaces the single clients.phone + text_phone pair added earlier the same day: people
-- don't have "a phone and a texting phone", they have a list of numbers — a cell, an
-- office line, a husband's phone — and each one takes some kinds of contact and not
-- others. A number defaults to calls and texts, which is what almost every number is.
--
-- clients.phone stays as the main number and is kept in step with whichever row is
-- is_primary, because invoices, exports, the call button and the client list all read it.
-- The list is the place numbers are edited; clients.phone follows.
CREATE TABLE IF NOT EXISTS client_phones (
  id           BIGSERIAL PRIMARY KEY,
  -- bigint, like every other id here: an int id overflowed once already (mentions.source_id).
  client_id    BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  label        TEXT,                                  -- "cell", "office", "husband" — optional
  for_calls    BOOLEAN NOT NULL DEFAULT true,
  for_texts    BOOLEAN NOT NULL DEFAULT true,
  for_whatsapp BOOLEAN NOT NULL DEFAULT false,
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Anything a person typed says who typed it and when.
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A table created outside the migration path doesn't get RLS; this one is created here and
-- gets it in the same breath. RLS on with no policy = owner only, which is the intent.
ALTER TABLE client_phones ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_phones_client_idx ON client_phones (client_id);
-- Matching an incoming number back to a person, the same last-ten-digits comparison the
-- rest of the app uses.
CREATE INDEX IF NOT EXISTS client_phones_digits_idx
  ON client_phones (right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10));

-- Every number on file today becomes that client's main number, taking calls and texts —
-- exactly how it behaved before this existed. "On WhatsApp?" was an answer about the
-- number, so it carries over onto the number rather than being left behind on the client.
INSERT INTO client_phones (client_id, phone, for_calls, for_texts, for_whatsapp, is_primary, created_by)
SELECT id, phone, true, true, coalesce(phone_whatsapp,'') = 'Yes', true, 'migration'
  FROM clients
 WHERE coalesce(phone,'') <> ''
   AND NOT EXISTS (SELECT 1 FROM client_phones p WHERE p.client_id = clients.id);

-- One definition of "which number does a text go to", used by every send path rather than
-- each one re-deciding: the first number marked for texts, main number first. A client
-- with numbers on file but none that takes texts gets NULL — no silent fallback to a
-- number somebody deliberately unticked. A client with no rows at all still falls back to
-- clients.phone, so nothing breaks if a client is created outside this list.
CREATE OR REPLACE FUNCTION client_text_phone(cid BIGINT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM client_phones p WHERE p.client_id = cid)
    THEN (SELECT p.phone FROM client_phones p
           WHERE p.client_id = cid AND p.for_texts AND coalesce(p.phone,'') <> ''
           ORDER BY p.is_primary DESC, p.sort_order, p.id
           LIMIT 1)
    ELSE (SELECT c.phone FROM clients c WHERE c.id = cid)
  END
$$ LANGUAGE sql STABLE;

-- The stop-gap from earlier today, superseded by the list above. It never held any data.
ALTER TABLE clients DROP COLUMN IF EXISTS text_phone;
