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
// A client can have several numbers, each ticked for calls, texts and/or WhatsApp. The
// text goes to the first one marked for texts, main number first. That rule lives in the
// database as client_text_phone() (migration 035) so the multi-row queries — the weekly
// run, the contact picker — can use the same definition rather than each re-deciding it.
//
// A client with numbers on file but none marked for texts gets nothing, deliberately: no
// silent fallback to a number somebody unticked on purpose. Texting a landline fails
// silently — Telnyx accepts it and it lands nowhere — so a soft preference would just be
// a silent failure with extra steps.
async function textingNumber(clientId) {
  if (!clientId) return null;
  const { rows: [r] } = await pool.query('SELECT client_text_phone($1) AS phone', [clientId]);
  const p = r?.phone;
  return p && String(p).trim() ? String(p).trim() : null;
}

// Last ten digits, so "(917) 555-1234", "917-555-1234" and "+19175551234" compare equal.
function sameNumber(a, b) {
  const d = v => String(v || '').replace(/\D/g, '').slice(-10);
  const x = d(a);
  return x.length === 10 && x === d(b);
}

// "You're texting a number that isn't for texts." Returns null when there's nothing wrong.
//
// Only fires for a number that is on file for a client AND unticked for texts — a number
// nobody has said anything about is left alone, and a client with one ordinary number can
// never trip it.
async function callOnlyNumberLookup(to) {
  const d = String(to || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return null;
  const { rows: [row] } = await pool.query(
    `SELECT c.id, c.name, p.phone, p.label, p.for_calls, p.for_whatsapp,
            client_text_phone(c.id) AS texting_number
       FROM client_phones p
       JOIN clients c ON c.id = p.client_id
      WHERE right(regexp_replace(coalesce(p.phone,''), '[^0-9]', '', 'g'), 10) = $1
        AND p.for_texts = false
      LIMIT 1`, [d]);
  if (!row) return null;
  // Ticked for texts on another row of the same client's list — the same number twice,
  // once for calls and once for texts. Nothing to complain about.
  if (sameNumber(row.texting_number, to)) return null;

  const isFor = [row.for_calls && 'calls', row.for_whatsapp && 'WhatsApp'].filter(Boolean).join(' and ');
  const what = isFor ? `that number is for ${isFor}` : `that number isn't marked for texts`;
  return {
    blocked: true,
    client_name: row.name,
    texting_number: row.texting_number || null,
    // Names the way out rather than being a dead end, same as the do-not-text message.
    reason: row.texting_number
      ? `${row.name} doesn't take texts at ${String(row.phone).trim()} — ${what}. Texts go to ${String(row.texting_number).trim()}.`
      : `${row.name} doesn't take texts at ${String(row.phone).trim()} — ${what}, and there's no texting number on their profile.`,
  };
}

module.exports = { clientTextingBlocked, textingNumber, sameNumber, callOnlyNumberLookup };
