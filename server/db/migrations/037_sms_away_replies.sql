-- The away message on the texting line: one automatic reply to each person who texts in
-- while the office is closed (a Yom Tov, a vacation). The message and its dates live in
-- app_settings under 'sms_away_message'; this table remembers who has already been
-- answered in each closed period, so someone who sends five texts gets one reply, not
-- five — and two texts arriving in the same second can't both win, because the reply is
-- claimed by inserting the row before the text goes out.
CREATE TABLE IF NOT EXISTS sms_away_replies (
  id         BIGSERIAL PRIMARY KEY,
  period     TEXT        NOT NULL,   -- the closed period's start, as stored in the setting
  phone      TEXT        NOT NULL,   -- last ten digits
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, phone)
);
ALTER TABLE sms_away_replies ENABLE ROW LEVEL SECURITY;
