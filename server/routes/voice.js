// Voice (phone calls) on the BGM Telnyx line.
//
// Right now this file only *reads* the Telnyx account and reports what is there. Calling
// needs several things to line up on Telnyx's side — the number has to have voice enabled,
// there has to be a Call Control application to route inbound calls to, an outbound voice
// profile to bill outbound ones against, and a credential connection per person who wants
// to talk through their browser. Rather than guess at which of those already exist, this
// endpoint says so plainly, and the rest of the feature is built on top of the answer.
//
// The Telnyx API key lives only in the deployed environment, so this has to run on the
// server; there is no way to look any of this up from a laptop.

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
// requireAdmin only inspects req.user — without requireAuth ahead of it there is no
// user to inspect, and every request is refused as if it came from a stranger.
router.use(requireAuth);

const TELNYX = 'https://api.telnyx.com/v2';

async function telnyx(path) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.errors?.[0];
    return { error: err?.detail || err?.title || `Telnyx ${res.status}`, status: res.status };
  }
  return data;
}

// Read-only. Admin-only because it describes the whole phone account, not one conversation.
router.get('/status', requireAdmin, async (req, res) => {
  try {
    const [numbers, voiceSettings, apps, connections, outbound] = await Promise.all([
      telnyx('/phone_numbers?page[size]=50'),
      telnyx('/phone_numbers/voice?page[size]=50'),
      telnyx('/call_control_applications?page[size]=50'),
      telnyx('/connections?page[size]=50'),
      telnyx('/outbound_voice_profiles?page[size]=50'),
    ]);

    res.json({
      env: {
        api_key: Boolean(process.env.TELNYX_API_KEY),
        from_number: process.env.TELNYX_FROM_NUMBER || null,
        messaging_profile: Boolean(process.env.TELNYX_MESSAGING_PROFILE_ID),
        public_key: Boolean(process.env.TELNYX_PUBLIC_KEY),
      },
      numbers: numbers.error ? numbers : (numbers.data || []).map(n => ({
        phone_number: n.phone_number,
        status: n.status,
        connection_id: n.connection_id,
        connection_name: n.connection_name,
        messaging_profile_id: n.messaging_profile_id,
        features: n.phone_number_type,
      })),
      voice_settings: voiceSettings.error ? voiceSettings : (voiceSettings.data || []).map(v => ({
        phone_number: v.phone_number,
        connection_name: v.connection_name,
        caller_id_name_enabled: v.caller_id_name_enabled,
        call_forwarding: v.call_forwarding,
        tech_prefix_enabled: v.tech_prefix_enabled,
      })),
      call_control_applications: apps.error ? apps : (apps.data || []).map(a => ({
        id: a.id, name: a.application_name, webhook: a.webhook_event_url, active: a.active,
      })),
      connections: connections.error ? connections : (connections.data || []).map(c => ({
        id: c.id, name: c.connection_name, type: c.record_type, active: c.active,
      })),
      outbound_voice_profiles: outbound.error ? outbound : (outbound.data || []).map(o => ({
        id: o.id, name: o.name, enabled: o.enabled,
        service_plan: o.service_plan, usage_limit: o.usage_payment_limit,
      })),
    });
  } catch (e) {
    console.error('[voice] status failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
