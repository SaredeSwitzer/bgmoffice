// Server-side Telnyx SMS sender for BGM Office. Mirrors Amber/telnyx.mjs so both use the same
// send path. Reads TELNYX_API_KEY / TELNYX_FROM_NUMBER / TELNYX_MESSAGING_PROFILE_ID from the env
// (Vercel prod). Node's global fetch is available on the Vercel runtime.

const API = 'https://api.telnyx.com/v2/messages';

// Normalize a US number to E.164 (+1XXXXXXXXXX). Leaves already-plus-prefixed input alone.
function toE164(raw) {
  const s = String(raw || '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (s.startsWith('+')) return s;
  return '+' + d;
}

async function sendSMS({ to, text }) {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY not set');
  const body = { to: toE164(to), text: String(text || '') };
  if (process.env.TELNYX_FROM_NUMBER) body.from = process.env.TELNYX_FROM_NUMBER;
  if (process.env.TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = process.env.TELNYX_MESSAGING_PROFILE_ID;

  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.errors?.[0];
    throw new Error(err?.detail || err?.title || `Telnyx send failed (${res.status})`);
  }
  return data.data;
}

module.exports = { sendSMS, toE164 };
