// Persistence for phone calls on the BGM line — who wants to be rung where, and what
// happened on every call.
//
// Calls and texts are deliberately keyed the same way: `phone` is the OTHER party's
// number, normalised through toE164, never our own 917 line. That is what lets a client's
// calls and their texts be shown as one history of dealing with that person.

const pool = require('../db/pg');
const { toE164 } = require('./telnyxSend');

// ── Who rings where ──────────────────────────────────────────────────────────────────

async function getVoiceUser(userId) {
  const { rows } = await pool.query('SELECT * FROM voice_users WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

// Everyone who should be rung when a call comes in. A person with neither their browser
// nor their cell turned on is simply not rung — that is how somebody goes off duty.
async function ringTargets() {
  const { rows } = await pool.query(`
    SELECT v.user_id, v.cell_phone, v.ring_browser, v.ring_cell, v.sip_username,
           u.name, u.initials
      FROM voice_users v
      JOIN users u ON u.id = v.user_id
     WHERE (v.ring_browser AND v.sip_username IS NOT NULL)
        OR (v.ring_cell AND coalesce(v.cell_phone,'') <> '')
  `);
  return rows;
}

async function upsertVoiceUser(userId, fields, initials) {
  const { rows } = await pool.query(
    `INSERT INTO voice_users (user_id, cell_phone, ring_browser, ring_cell, created_by)
     VALUES ($1, $2, coalesce($3, true), coalesce($4, false), $5)
     ON CONFLICT (user_id) DO UPDATE SET
       cell_phone   = coalesce(EXCLUDED.cell_phone, voice_users.cell_phone),
       ring_browser = coalesce($3, voice_users.ring_browser),
       ring_cell    = coalesce($4, voice_users.ring_cell),
       updated_at   = now()
     RETURNING *`,
    [userId, fields.cell_phone ? toE164(fields.cell_phone) : null,
     fields.ring_browser ?? null, fields.ring_cell ?? null, initials || null]
  );
  return rows[0];
}

// The Telnyx SIP credential that lets one person's browser be a phone. Stored separately
// from the settings above because it is minted by Telnyx, not typed by a person.
async function saveCredential(userId, credentialId, sipUsername) {
  await pool.query(
    `INSERT INTO voice_users (user_id, telnyx_credential_id, sip_username)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       telnyx_credential_id = EXCLUDED.telnyx_credential_id,
       sip_username         = EXCLUDED.sip_username,
       updated_at           = now()`,
    [userId, credentialId, sipUsername]
  );
}

// ── The call log ─────────────────────────────────────────────────────────────────────

async function startCall(c) {
  const { rows } = await pool.query(
    `INSERT INTO voice_calls
       (call_control_id, call_session_id, parent_call_control_id, direction, leg,
        from_number, to_number, phone, person_id, person_kind, person_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [c.call_control_id || null, c.call_session_id || null, c.parent_call_control_id || null,
     c.direction, c.leg || 'primary', c.from_number || null, c.to_number || null,
     c.phone || null, c.person_id || null, c.person_kind || null, c.person_name || null,
     c.status || 'ringing']
  );
  return rows[0];
}

async function findByCallControlId(ccid) {
  const { rows } = await pool.query(
    'SELECT * FROM voice_calls WHERE call_control_id = $1 LIMIT 1', [ccid]);
  return rows[0] || null;
}

// The phones still ringing for one incoming call — the ones to hang up the moment
// somebody else picks up.
async function siblingLegs(parentCcid, exceptCcid) {
  const { rows } = await pool.query(
    `SELECT * FROM voice_calls
      WHERE parent_call_control_id = $1
        AND call_control_id <> $2
        AND status = 'ringing'`,
    [parentCcid, exceptCcid || '']);
  return rows;
}

async function markAnswered(ccid, answeredBy) {
  await pool.query(
    `UPDATE voice_calls
        SET status = 'answered', answered_at = now(),
            answered_by = coalesce($2, answered_by)
      WHERE call_control_id = $1`,
    [ccid, answeredBy || null]);
}

// A call that ends without ever having been answered is a missed call, and has to read as
// one in the log — not as a zero-second conversation.
async function markEnded(ccid, status, hangupCause, sipHangupCause) {
  await pool.query(
    `UPDATE voice_calls
        SET status = CASE
              WHEN $2::text IS NOT NULL THEN $2
              WHEN answered_at IS NOT NULL THEN 'completed'
              ELSE 'missed'
            END,
            hangup_cause     = coalesce($3, hangup_cause),
            sip_hangup_cause = coalesce($4, sip_hangup_cause),
            ended_at = now(),
            duration_seconds = CASE
              WHEN answered_at IS NOT NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - answered_at))::int)
              ELSE 0
            END
      WHERE call_control_id = $1`,
    [ccid, status || null, hangupCause || null, sipHangupCause || null]);
}

// The call history for the Calls screen: only the real calls, not the individual phones
// that were rung trying to find someone to answer them.
//
// Searchable the same way texts are — by who it was or by the number, typed however a
// person types a number. Note the doubled backslash in '\\D': this SQL is a JS template
// literal, where a lone \D collapses to D and would strip the letter D out of phone
// numbers instead of the punctuation.
async function listCalls(limit = 100, q = null) {
  const term = String(q || '').trim();
  const raw = term.replace(/\D/g, '');
  // A number typed with a country code is the same number; match on the last ten digits.
  const digits = raw.length > 10 ? raw.slice(-10) : raw;
  // Three digits is an area code, not a person.
  const phoneDigits = digits.length >= 4 ? digits : null;

  const { rows } = await pool.query(
    `SELECT * FROM voice_calls
      WHERE leg = 'primary'
        AND ($2::text IS NULL
             OR person_name ILIKE '%' || $2 || '%'
             OR answered_by  ILIKE '%' || $2 || '%'
             OR ($3::text IS NOT NULL
                 AND right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10)
                     LIKE '%' || $3 || '%'))
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit, term || null, phoneDigits]);
  return rows;
}

async function listCallsFor(phone, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM voice_calls
      WHERE leg = 'primary' AND phone = $1
      ORDER BY started_at DESC
      LIMIT $2`, [toE164(phone), limit]);
  return rows;
}


// A message left when nobody picked up. Stored against the call itself.
async function saveVoicemail(ccid, url, seconds) {
  await pool.query(
    `UPDATE voice_calls
        SET voicemail_url = $2,
            voicemail_seconds = coalesce($3, voicemail_seconds),
            status = 'voicemail'
      WHERE call_control_id = $1`,
    [ccid, url, seconds || null]);
}

async function markVoicemailHeard(id) {
  await pool.query('UPDATE voice_calls SET voicemail_heard_at = now() WHERE id = $1', [id]);
}


// Transcription arrives in pieces as the person speaks, so each final fragment is
// appended rather than replacing what came before. Interim guesses are dropped by the
// caller — keeping them would leave half-corrected words in the text.
async function appendTranscript(ccid, text, kind) {
  if (!String(text || '').trim()) return;
  await pool.query(
    `UPDATE voice_calls
        SET transcript = trim(both ' ' from coalesce(transcript || ' ', '') || $2),
            transcript_kind = coalesce(transcript_kind, $3)
      WHERE call_control_id = $1`,
    [ccid, String(text).trim(), kind || null]);
}

module.exports = {
  appendTranscript,
  saveVoicemail, markVoicemailHeard,
  getVoiceUser, ringTargets, upsertVoiceUser, saveCredential,
  startCall, findByCallControlId, siblingLegs, markAnswered, markEnded,
  listCalls, listCallsFor,
};
