-- Two-way SMS inbox: every inbound + outbound text on the BGM Office line (+1 917-719-2201).
-- Threads are keyed by `phone` = the other party's E.164 number. Also created lazily at runtime by
-- server/lib/smsStore.js ensureSchema(); this file keeps the migration set in parity. Idempotent.
CREATE TABLE IF NOT EXISTS sms_messages (
  id           bigserial PRIMARY KEY,
  direction    text NOT NULL,
  phone        text NOT NULL,
  from_number  text,
  to_number    text,
  body         text,
  telnyx_id    text,
  status       text,
  person_id    integer,
  person_kind  text,
  person_name  text,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_phone_idx ON sms_messages (phone, created_at);

-- Added 2026-09-15. Its absence meant this table was reachable through Supabase's public
-- REST API with the anon key — the key that ships in browsers and is not a secret — so
-- every text the business had sent or received was readable by anyone with the project
-- URL. Every other table had this; this one was missed because it is also created at
-- runtime by server/lib/smsStore.js rather than only here.
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
