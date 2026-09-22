const pool = require('../db/pg');

// Whether we are allowed to text this client at all.
//
// Some clients have asked us not to be texted, and one of them — Connections — gets
// genuinely annoyed when it happens. Before this the only setting was a weekly-reminder
// opt-out, so a client who wanted no texts still got class confirmations and change
// alerts; somebody had resorted to renaming the client "… - DO NOT TEXT" to warn staff
// off, which is as clear a sign as you get that the setting people needed did not exist.
//
// Checked on the server rather than only hiding the button, because the button is not the
// only way a text goes out — a class change fires one on its own.
async function clientTextingBlocked(clientId) {
  if (!clientId) return null;
  const { rows: [c] } = await pool.query(
    'SELECT name, no_texting FROM clients WHERE id = $1', [clientId]);
  if (!c?.no_texting) return null;
  return {
    blocked: true,
    client_name: c.name,
    // Said the way she would say it, and it names the way out rather than being a dead end.
    reason: `${c.name} has asked not to be texted. You can turn that off on their profile if it has changed.`,
  };
}

// ── Which of a client's numbers a text goes to ──────────────────────────────────────
//
// Most clients have one number and it does both jobs. A few answer calls on a landline or
// an office line and read texts on a cell, so they get a second number, and then the rule
// is simple and applied in one place: texts go to text_phone when there is one, otherwise
// to phone. Nobody sending a text has to remember which client is which.
//
// Deliberately not a "preferred" number: when both are on file the first one is call-only,
// because texting a landline fails silently — Telnyx accepts the message and it lands
// nowhere, so a soft preference would just be a silent failure with extra steps.
function textingNumber(client) {
  const pick = client?.text_phone || client?.phone || null;
  return pick && String(pick).trim() ? pick : null;
}

// Last ten digits, so "(917) 555-1234", "917-555-1234" and "+19175551234" compare equal.
function sameNumber(a, b) {
  const d = v => String(v || '').replace(/\D/g, '').slice(-10);
  const x = d(a);
  return x.length === 10 && x === d(b);
}

// "You're texting the number they only take calls at." Returns null when there's nothing
// wrong — one number on file, or the right one picked.
//
// Only ever fires for a client who has both numbers filled in: with one number there is
// nothing to get wrong, so nothing is ever blocked.
function callOnlyNumber(client, to) {
  const text = client?.text_phone;
  if (!text || !String(text).trim()) return null;
  if (!sameNumber(client?.phone, to)) return null;
  if (sameNumber(text, to)) return null;
  return {
    blocked: true,
    client_name: client?.name || null,
    texting_number: String(text).trim(),
    // Names the way out rather than being a dead end, same as the do-not-text message.
    reason: `${client?.name || 'That client'} doesn't take texts at ${String(client.phone).trim()} — that's their number for calls. Texts go to ${String(text).trim()}.`,
  };
}

// The same check starting from a number rather than a client: used by the Texts page,
// where all you have is whatever number was typed or picked.
async function callOnlyNumberLookup(to) {
  const d = String(to || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return null;
  const { rows: [c] } = await pool.query(
    `SELECT name, phone, text_phone FROM clients
      WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1
        AND coalesce(text_phone,'') <> ''
      LIMIT 1`, [d]);
  return c ? callOnlyNumber(c, to) : null;
}

module.exports = { clientTextingBlocked, textingNumber, sameNumber, callOnlyNumber, callOnlyNumberLookup };
