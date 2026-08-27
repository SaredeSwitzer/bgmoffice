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
