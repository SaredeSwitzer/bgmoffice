// Persistence for the two-way SMS inbox. Every inbound + outbound text is logged here so the
// BGM Office "Texts" screen can show threaded conversations and staff can reply.
//
// The table is created lazily via ensureSchema() using the runtime pool (CREATE TABLE IF NOT
// EXISTS), so it works on Vercel without a separate migrate step — we do not have DATABASE_URL
// outside the deployed app. A matching migration file (016_sms_messages.sql) exists for parity.
//
// Threads are keyed by `phone` = the OTHER party's E.164 number (the client/instructor, never our
// own 917 line). Inbound rows store the sender there; outbound rows store the recipient there.

const pool = require('../db/pg');

let _ready = null;
function ensureSchema() {
  if (!_ready) {
    _ready = pool.query(`
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
    `).catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

async function logMessage(m) {
  await ensureSchema();
  const readAt = m.direction === 'outbound' ? new Date() : (m.read_at || null);
  const { rows } = await pool.query(
    `INSERT INTO sms_messages
       (direction, phone, from_number, to_number, body, telnyx_id, status,
        person_id, person_kind, person_name, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [m.direction, m.phone, m.from_number || null, m.to_number || null, m.body || null,
     m.telnyx_id || null, m.status || null, m.person_id || null, m.person_kind || null,
     m.person_name || null, readAt]
  );
  return rows[0];
}

async function updateStatusByTelnyxId(telnyxId, status) {
  if (!telnyxId || !status) return;
  await ensureSchema();
  await pool.query('UPDATE sms_messages SET status = $1 WHERE telnyx_id = $2', [status, telnyxId]);
}

// One row per phone thread: latest message preview + unread count + best-known person name.
async function listThreads() {
  await ensureSchema();
  const { rows } = await pool.query(`
    SELECT t.phone,
           t.last_at,
           t.unread,
           t.person_name,
           t.person_kind,
           m.body      AS last_body,
           m.direction AS last_direction
      FROM (
        SELECT phone,
               max(created_at) AS last_at,
               count(*) FILTER (WHERE direction = 'inbound' AND read_at IS NULL) AS unread,
               max(person_name) AS person_name,
               max(person_kind) AS person_kind
          FROM sms_messages
         GROUP BY phone
      ) t
      JOIN LATERAL (
        SELECT body, direction FROM sms_messages s
         WHERE s.phone = t.phone
         ORDER BY created_at DESC
         LIMIT 1
      ) m ON true
     ORDER BY t.last_at DESC
  `);
  return rows;
}

async function listThread(phone) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, direction, from_number, to_number, body, status, person_name, person_kind, created_at
       FROM sms_messages
      WHERE phone = $1
      ORDER BY created_at ASC`,
    [phone]
  );
  return rows;
}

async function markRead(phone) {
  await ensureSchema();
  await pool.query(
    `UPDATE sms_messages SET read_at = now()
      WHERE phone = $1 AND direction = 'inbound' AND read_at IS NULL`,
    [phone]
  );
}

module.exports = { ensureSchema, logMessage, updateStatusByTelnyxId, listThreads, listThread, markRead };
