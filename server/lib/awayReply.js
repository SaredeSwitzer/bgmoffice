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
// The setting is JSON in app_settings under 'sms_away_message': a LIST of closed periods,
//   [{ "text": "...", "voice_text": "...", "starts_at": ISO, "ends_at": ISO, "enabled": true }]
// so a run of holidays can be set up in one sitting — Yom Tov, then Chol Hamoed, then
// Yom Tov again — each switching on and off by itself. (A single object, the first shape
// this took, is still read as a list of one.) `voice_text`, if set, is what callers hear
// on voicemail during that period instead of the everyday greeting.

const KEY = 'sms_away_message';

// Carrier keywords. Telnyx handles these at the campaign level; answering them with
// "we're closed" would be wrong at best and, for STOP, a text to someone who just
// asked not to be texted.
const KEYWORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|help|info|start|unstop|yes)$/i;

async function listAways() {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [KEY]);
  if (!rows[0]?.value) return [];
  try {
    const v = JSON.parse(rows[0].value);
    return (Array.isArray(v) ? v : [v]).filter(Boolean);
  } catch { return []; }
}

function isOn(away, now = new Date()) {
  if (!away?.enabled || !away.text?.trim()) return false;
  const start = away.starts_at ? new Date(away.starts_at) : null;
  const end   = away.ends_at   ? new Date(away.ends_at)   : null;
  if (start && now < start) return false;
  if (end && now >= end) return false;
  return true;
}

// The period in force right now, if any.
async function getAway() {
  return (await listAways()).find(a => isOn(a)) || null;
}

async function saveAways(list) {
  const clean = (list || [])
    .filter(a => a && String(a.text || '').trim())
    .sort((a, b) => String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KEY, JSON.stringify(clean)]);
  return clean;
}

// What callers hear on voicemail right now: the closed period's own words, or null for
// the everyday greeting.
async function awayVoicemailGreeting() {
  try {
    const a = await getAway();
    return a?.voice_text?.trim() || null;
  } catch { return null; }
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

module.exports = { listAways, getAway, saveAways, isOn, maybeAwayReply, awayVoicemailGreeting };
