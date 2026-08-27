// Handles inbound Telnyx webhooks for the BGM Office SMS line (+1 917-719-2201).
//
// Registered in app.js with a RAW body parser and BEFORE express.json(), because the Ed25519
// signature is computed over the exact request bytes. Mirrors the existing Stripe webhook.
//
// Config (server/.env locally, Vercel env in prod):
//   TELNYX_PUBLIC_KEY   base64 Ed25519 public key from the Telnyx portal (Account > API Keys >
//                       Public Key). Also read from app_settings.telnyx_public_key if present.
// Set the "BGM Reminders" messaging profile Webhook URL to:
//   https://<bgmoffice-domain>/api/telnyx/webhook
//
// On an inbound reply we recognize the sender (client or instructor by phone) AND pull their next
// few upcoming sessions, so whoever reads the crew alert has the context to answer right away.
//
// STOP/HELP/START are handled by Telnyx at the campaign level — we surface but do not act on them.

const crypto = require('crypto');
const pool = require('../db/pg');
const { notifyCrew } = require('./notifyCrew');
const smsStore = require('./smsStore');

// Wrap a raw 32-byte Ed25519 public key in DER/SPKI so Node's crypto can use it.
function ed25519KeyFromBase64(b64) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error(`bad Ed25519 public key length ${raw.length}`);
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]); // SPKI header
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// Verify a Telnyx webhook. message = `${timestamp}|${rawBody}`; signature is base64 Ed25519.
function verifySignature({ rawBody, signature, timestamp, publicKeyB64, toleranceSec = 300 }) {
  if (!signature || !timestamp || !publicKeyB64) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSec) return false; // replay guard
  let key, sig;
  try { key = ed25519KeyFromBase64(publicKeyB64); } catch { return false; }
  try { sig = Buffer.from(signature, 'base64'); } catch { return false; }
  const msg = Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]);
  try { return crypto.verify(null, msg, key, sig); } catch { return false; }
}

async function getPublicKey() {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='telnyx_public_key'");
    if (rows[0]?.value) return rows[0].value;
  } catch { /* fall through to env */ }
  return process.env.TELNYX_PUBLIC_KEY || '';
}

// Best-effort: match the sender's number (last 10 digits) to a client or instructor.
// Returns { id, name, kind } or null.
async function lookupPerson(fromNumber) {
  const digits = (fromNumber || '').replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, 'client' AS kind FROM clients
         WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1
       UNION ALL
       SELECT id, name, 'instructor' AS kind FROM instructors
         WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1
       LIMIT 1`,
      [digits]
    );
    return rows[0] || null;
  } catch (e) {
    console.error('[telnyx inbound] person lookup failed:', e.message);
    return null;
  }
}

// The sender's next few sessions, with the other party's name. Dates/times are formatted in SQL to
// avoid JS timezone drift. `kind` comes from lookupPerson (a fixed whitelist), never user input.
async function getUpcomingSessions(person, limit = 3) {
  if (!person?.id) return [];
  const isClient = person.kind === 'client';
  const idCol = isClient ? 'client_id' : 'instructor_id';
  const joinTbl = isClient ? 'instructors' : 'clients';
  const joinCol = isClient ? 'instructor_id' : 'client_id';
  try {
    const { rows } = await pool.query(
      `SELECT to_char(cs.session_date, 'Dy FMMM/FMDD') AS d,
              to_char(cs.start_time,  'FMHH12:MI AM')  AS t,
              cs.style AS style,
              o.name AS other
         FROM class_sessions cs
         LEFT JOIN ${joinTbl} o ON o.id = cs.${joinCol}
        WHERE cs.${idCol} = $1
          AND cs.session_date >= current_date
          AND cs.status NOT IN ('cancelled', 'canceled', 'deleted')
        ORDER BY cs.session_date, cs.start_time
        LIMIT ${Number(limit)}`,
      [person.id]
    );
    return rows;
  } catch (e) {
    console.error('[telnyx inbound] schedule lookup failed:', e.message);
    return [];
  }
}

function formatSessionLine(s) {
  const style = s.style ? ` ${s.style}` : '';
  const other = s.other ? ` — with ${s.other}` : '';
  return `${s.d} ${s.t}${style}${other}`;
}

// Pure: build the crew alert text for an inbound reply. Kept separate so it can be unit-tested.
function buildReplyNotice({ from, text, person, sessions }) {
  const who = person ? `${person.name} (${person.kind}, ${from})` : from;
  let msg = `📩 SMS reply from ${who}:\n${text || '(no text / media)'}`;
  if (person) {
    if (sessions && sessions.length) {
      msg += `\n\ntheir upcoming:\n` + sessions.map(formatSessionLine).join('\n');
    } else {
      msg += `\n\n(no upcoming sessions on file)`;
    }
  }
  return msg;
}

async function handleWebhook(req, res) {
  const rawBody = req.body; // Buffer (express.raw)
  const publicKeyB64 = await getPublicKey();

  if (publicKeyB64) {
    const ok = verifySignature({
      rawBody,
      signature: req.headers['telnyx-signature-ed25519'],
      timestamp: req.headers['telnyx-timestamp'],
      publicKeyB64,
    });
    if (!ok) {
      console.error('[telnyx inbound] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }
  } else {
    console.warn('[telnyx inbound] TELNYX_PUBLIC_KEY not set — skipping signature verification');
  }

  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }

  const type = event?.data?.event_type;
  const payload = event?.data?.payload || {};

  try {
    if (type === 'message.received') {
      const from = payload.from?.phone_number || 'unknown';
      const text = (payload.text || '').trim();
      const person = await lookupPerson(from);
      const sessions = person ? await getUpcomingSessions(person) : [];
      try {
        await smsStore.logMessage({ direction: 'inbound', phone: from, from_number: from,
          to_number: payload.to?.[0]?.phone_number || null, body: text, telnyx_id: payload.id,
          status: 'received', person_id: person?.id, person_kind: person?.kind, person_name: person?.name });
      } catch (e) { console.error('[telnyx inbound] sms log failed:', e.message); }
      await notifyCrew(buildReplyNotice({ from, text, person, sessions }));
    } else if (type === 'message.finalized' || type === 'message.sent') {
      // Outbound: reminders sent via Amber AND replies from the Texts UI both flow through this
      // messaging profile, so log every outbound here (dedup by telnyx_id) to fill the inbox.
      const to = payload.to?.[0];
      const outPhone = to?.phone_number;
      if (outPhone) {
        try {
          const outPerson = await lookupPerson(outPhone);
          await smsStore.logOutboundFromWebhook({
            telnyx_id: payload.id, phone: outPhone, from_number: payload.from?.phone_number || null,
            to_number: outPhone, body: payload.text || null,
            status: to?.status || (type === 'message.sent' ? 'sent' : 'finalized'),
            person_id: outPerson?.id, person_kind: outPerson?.kind, person_name: outPerson?.name });
        } catch (e) { console.error('[telnyx inbound] outbound log failed:', e.message); }
      }
      // Only surface delivery FAILURES to the crew; successes are noise.
      const errs = payload.errors;
      const failed = (to?.status && to.status !== 'delivered' && to.status !== 'sent')
        || (Array.isArray(errs) && errs.length);
      if (type === 'message.finalized' && failed) {
        const detail = Array.isArray(errs) && errs.length
          ? errs.map(e => e.detail || e.title || e.code).join('; ')
          : (to?.status || 'unknown');
        await notifyCrew(`⚠️ SMS to ${to?.phone_number || 'unknown'} failed: ${detail}`);
      }
    }
  } catch (e) {
    console.error('[telnyx inbound] handler error:', e.message);
    // fall through to 200 so Telnyx does not retry on our internal error
  }

  res.json({ received: true });
}

module.exports = {
  handleWebhook,
  verifySignature,
  lookupPerson,
  getUpcomingSessions,
  buildReplyNotice,
};
