-- Numbers we text or call that are nobody in the book yet.
--
-- Thirteen such numbers had built up: a person on the other end of a real conversation,
-- shown as a bare phone number every time, with no way to write down who they are short of
-- inventing a client record for someone who is not a client.
--
-- Clients and instructors still live in their own tables — a lead who becomes a client
-- should BE a client, not a contact with a label. This is for the in-between: somebody
-- thinking about classes, an instructor who has not been taken on, a landlord, a parent
-- calling about their mother. Name and category only; the moment they become real, they
-- get a real record.
CREATE TABLE IF NOT EXISTS phone_contacts (
  id          BIGSERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,          -- potential_client | potential_instructor | other
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Created here rather than by application code, so it cannot be missed the way
-- sms_messages was — see CLAUDE.md.
ALTER TABLE phone_contacts ENABLE ROW LEVEL SECURITY;

-- One entry per number, matched the way every other phone lookup in the app matches:
-- on the last ten digits, because the same number is stored half a dozen ways.
CREATE UNIQUE INDEX IF NOT EXISTS phone_contacts_digits
  ON phone_contacts (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10));
