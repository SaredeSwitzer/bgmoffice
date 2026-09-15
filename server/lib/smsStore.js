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
           -- Needed by the Texts screen to ask "start a Waiting On line for them?" — it
           -- has to know who they are on the sheet, not just what they're called.
           t.person_id,
           m.body      AS last_body,
           m.direction AS last_direction
      FROM (
        SELECT phone,
               max(created_at) AS last_at,
               count(*) FILTER (WHERE direction = 'inbound' AND read_at IS NULL) AS unread,
               max(person_name) AS person_name,
               max(person_kind) AS person_kind,
               max(person_id)   AS person_id
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

// Log an outbound text seen on the Telnyx webhook. If a row with this telnyx_id already exists
// (e.g. a reply just sent from the Texts UI), only refresh its status; otherwise insert a new
// outbound row (e.g. a reminder sent by Amber). Dedups so every send appears once.
async function logOutboundFromWebhook(m) {
  await ensureSchema();
  if (m.telnyx_id) {
    const { rows } = await pool.query('SELECT id FROM sms_messages WHERE telnyx_id = $1 LIMIT 1', [m.telnyx_id]);
    if (rows[0]) {
      if (m.status) await pool.query('UPDATE sms_messages SET status = $1 WHERE telnyx_id = $2', [m.status, m.telnyx_id]);
      return rows[0];
    }
  }
  return logMessage({ ...m, direction: 'outbound' });
}


// ── Search ───────────────────────────────────────────────────────────────────────────
// Two questions get asked of a text archive, and they are not the same question:
// "who have I texted about this?" (search the words) and "what did I say to her?"
// (find the person, then read the thread). Both are answered here, and the screen
// shows them as two lists, because a name match and a message match mean different
// things and collapsing them loses that.

// Matching a phone number typed any way a person types one — "917 719 2201",
// "(917) 719-2201", "7192201" — against numbers stored as +19177192201.
function digitsOf(q) {
  return String(q || '').replace(/\D/g, '');
}

// Messages whose words match. Newest first: a conversation from last week is almost
// always the one being looked for, not one from a year ago.
async function searchMessages(q, limit = 100) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, phone, direction, body, created_at, person_name, person_kind, person_id
       FROM sms_messages
      WHERE body ILIKE '%' || $1 || '%'
      ORDER BY created_at DESC
      LIMIT $2`,
    [q, limit]
  );
  return rows;
}

// People whose name or number matches — whether or not we have ever texted them.
// Someone she has never texted still has to be findable here, or "search your
// contacts" quietly means "search the people you already texted", which is the
// one case where you least need searching.
//
// Note the doubled backslash in '\\D' below: this SQL lives in a JS template literal,
// where a lone \D is not an escape sequence and silently collapses to D. That version
// stripped the letter D out of phone numbers instead of stripping punctuation, so a
// number stored as "(646) 942-6829" matched nothing and showed up as a second, empty
// copy of a contact she had in fact been texting for months.
async function searchPeople(q, limit = 40) {
  await ensureSchema();
  const raw = digitsOf(q);
  // "1 347 598 1140" and "347-598-1140" are one number, and contacts are stored both
  // ways. Everything below matches on the last ten digits so the two line up.
  const digits = raw.length > 10 ? raw.slice(-10) : raw;
  // A 3-digit "917" is an area code, not a number — only treat input as a phone
  // number search once there is enough of it to mean one person.
  const phoneDigits = digits.length >= 4 ? digits : null;

  const { rows } = await pool.query(
    `WITH people AS (
       SELECT id, name, phone, 'client' AS kind FROM clients WHERE coalesce(phone,'') <> ''
       UNION ALL
       SELECT id, name, phone, 'instructor' AS kind FROM instructors WHERE coalesce(phone,'') <> ''
     ),
     threads AS (
       SELECT phone,
              right(regexp_replace(phone, '\\D', '', 'g'), 10) AS key,
              max(created_at)   AS last_at,
              max(person_name)  AS person_name,
              max(person_kind)  AS person_kind,
              max(person_id)    AS person_id,
              count(*)::int     AS message_count
         FROM sms_messages
        GROUP BY phone
     ),
     matched_people AS (
       SELECT p.id, p.name, p.phone, p.kind,
              right(regexp_replace(p.phone, '\\D', '', 'g'), 10) AS key
         FROM people p
        WHERE p.name ILIKE '%' || $1 || '%'
           OR ($2::text IS NOT NULL
               AND right(regexp_replace(p.phone, '\\D', '', 'g'), 10) LIKE '%' || $2 || '%')
     ),
     -- Numbers with a history but no profile behind them: an unknown caller, a short
     -- code, a parent texting from a second phone. Searchable by the name we recorded
     -- at the time, or by the number itself.
     matched_threads AS (
       SELECT t.phone, t.key, t.person_name, t.person_kind, t.person_id,
              t.last_at, t.message_count
         FROM threads t
        WHERE coalesce(t.person_name,'') ILIKE '%' || $1 || '%'
           OR ($2::text IS NOT NULL AND t.key LIKE '%' || $2 || '%')
     )
     SELECT DISTINCT ON (norm_phone) *
       FROM (
         SELECT mp.key AS norm_phone,
                mp.id AS person_id, mp.name AS name, mp.phone AS phone, mp.kind AS person_kind,
                t.last_at, coalesce(t.message_count, 0) AS message_count
           FROM matched_people mp
           LEFT JOIN threads t ON t.key = mp.key
         UNION ALL
         SELECT mt.key AS norm_phone,
                mt.person_id, mt.person_name AS name, mt.phone, mt.person_kind,
                mt.last_at, mt.message_count
           FROM matched_threads mt
       ) u
      -- One row per person. Where a contact is on file twice under two spellings of
      -- the same number, keep the one that has the conversation attached to it.
      ORDER BY norm_phone, message_count DESC, last_at DESC NULLS LAST, phone DESC
      LIMIT $3`,
    [q, phoneDigits, limit]
  );

  // Ordering had to be by norm_phone for the DISTINCT ON; put it back into the order a
  // person expects — people you actually talk to first, then everyone else by name.
  return rows.sort((a, b) => {
    if (a.last_at && b.last_at) return new Date(b.last_at) - new Date(a.last_at);
    if (a.last_at) return -1;
    if (b.last_at) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

module.exports = { ensureSchema, searchMessages, searchPeople, logMessage, updateStatusByTelnyxId, logOutboundFromWebhook, listThreads, listThread, markRead };
