const pool = require('../db/pg');
const { sendSMS } = require('./telnyxSend');
const smsStore = require('./smsStore');

// The away message for the texting line.
//
// While the office is closed — Yom Tov, when nobody may answer the phone — anyone who
// texts in gets one automatic reply saying so, instead of silence they might read as
// being ignored. One reply per person per closed period: the reply is claimed in
// sms_away_replies before it is sent (migration 037).
//
// The setting is JSON in app_settings under 'sms_away_message':
//   { "text": "...", "starts_at": ISO, "ends_at": ISO, "enabled": true }
// and it switches itself off at ends_at — nobody has to remember to turn it off.

const KEY = 'sms_away_message';

// Carrier keywords. Telnyx handles these at the campaign level; answering them with
// "we're closed" would be wrong at best and, for STOP, a text to someone who just
// asked not to be texted.
const KEYWORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|help|info|start|unstop|yes)$/i;

async function getAway() {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [KEY]);
  if (!rows[0]?.value) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

function isOn(away, now = new Date()) {
  if (!away?.enabled || !away.text?.trim()) return false;
  const start = away.starts_at ? new Date(away.starts_at) : null;
  const end   = away.ends_at   ? new Date(away.ends_at)   : null;
  if (start && now < start) return false;
  if (end && now >= end) return false;
  return true;
}

async function saveAway(away) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KEY, JSON.stringify(away)]);
  return away;
}

// Called for every inbound text. Never throws — a failed away reply must not stop the
// text itself being logged and announced.
async function maybeAwayReply({ from, text, person }) {
  try {
    const away = await getAway();
    if (!isOn(away)) return;
    const digits = String(from || '').replace(/\D/g, '').slice(-10);
    if (digits.length < 10) return;                  // short codes and sender names
    if (KEYWORDS.test(String(text || '').trim())) return;

    const period = String(away.starts_at || 'always');
    const { rows } = await pool.query(
      `INSERT INTO sms_away_replies (period, phone) VALUES ($1, $2)
       ON CONFLICT (period, phone) DO NOTHING RETURNING id`, [period, digits]);
    if (!rows[0]) return;                            // already answered this period

    try {
      const sent = await sendSMS({ to: from, text: away.text.trim() });
      await smsStore.logMessage({
        direction: 'outbound', phone: from,
        from_number: process.env.TELNYX_FROM_NUMBER || null, to_number: from,
        body: away.text.trim(), telnyx_id: sent?.id || null,
        status: sent?.to?.[0]?.status || 'queued',
        person_id: person?.id, person_kind: person?.kind, person_name: person?.name,
      });
    } catch (e) {
      // Give the claim back so their next text tries again.
      await pool.query('DELETE FROM sms_away_replies WHERE id = $1', [rows[0].id]);
      throw e;
    }
  } catch (e) {
    console.error('[away reply] failed:', e.message);
  }
}

module.exports = { getAway, saveAway, isOn, maybeAwayReply };
