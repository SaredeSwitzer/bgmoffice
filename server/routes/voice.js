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

// The writing counterpart to telnyx(). Throws rather than returning an error shape, because
// a failed step in provisioning must stop the steps after it.
async function telnyxWrite(path, method, body) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.errors?.[0];
    throw new Error(err?.detail || err?.title || `Telnyx ${method} ${path} failed (${res.status})`);
  }
  return data.data;
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
        id: n.id,
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

// ── One-time provisioning ─────────────────────────────────────────────────────────────
// Turning the BGM number into a line that can make and take calls. Three things have to
// exist on Telnyx before any of that works, and as of today none of them do:
//
//   1. an outbound voice profile — what outbound minutes are billed against. Without one,
//      an outgoing call is rejected before it dials.
//   2. a call control application — what an incoming call is handed to. Its webhook is
//      this app, so we get to decide what a ringing call actually does.
//   3. the number pointed at that application. Until then the number has no voice routing
//      on it at all, which is why calling it currently does nothing whatsoever.
//
// Safe to run more than once: every step looks for what it would create and reuses it.
// Nothing here touches texting. Messages are routed by the messaging profile, a separate
// setting on the same number, and it is left exactly as it is.
const PROFILE_NAME = 'BGM Office outbound';
const APP_NAME = 'BGM Office calling';

router.post('/setup', requireAdmin, async (req, res) => {
  const steps = [];
  try {
    const base = process.env.PUBLIC_URL || 'https://bgmoffice.com';
    const webhook = `${base}/api/voice/webhook`;

    // 1. Outbound voice profile
    const profiles = await telnyx('/outbound_voice_profiles?page[size]=50');
    let profile = (profiles.data || []).find(p => p.name === PROFILE_NAME);
    if (profile) {
      steps.push({ step: 'outbound voice profile', action: 'already existed', id: profile.id });
    } else {
      profile = await telnyxWrite('/outbound_voice_profiles', 'POST', {
        name: PROFILE_NAME,
        traffic_type: 'conversational',
        service_plan: 'global',
        enabled: true,
        // The expensive failure here is a loop dialling out, not a busy Tuesday.
        concurrent_call_limit: 10,
      });
      steps.push({ step: 'outbound voice profile', action: 'created', id: profile.id });
    }

    // 2. Call control application, pointed at this app's webhook
    const apps = await telnyx('/call_control_applications?page[size]=50');
    let app = (apps.data || []).find(a => a.application_name === APP_NAME);
    if (app && app.webhook_event_url !== webhook) {
      app = await telnyxWrite(`/call_control_applications/${app.id}`, 'PATCH', {
        application_name: APP_NAME,
        webhook_event_url: webhook,
      });
      steps.push({ step: 'call control application', action: 'webhook corrected', id: app.id });
    } else if (app) {
      steps.push({ step: 'call control application', action: 'already existed', id: app.id });
    } else {
      app = await telnyxWrite('/call_control_applications', 'POST', {
        application_name: APP_NAME,
        webhook_event_url: webhook,
        webhook_api_version: '2',
        active: true,
        outbound: { outbound_voice_profile_id: profile.id },
      });
      steps.push({ step: 'call control application', action: 'created', id: app.id });
    }

    // 3. Point the number at it. Reversible: setting connection_id back to '' puts the
    //    number back in exactly the state it is in now.
    //
    // Deliberately opt-in, and deliberately last. Steps 1 and 2 are invisible — they create
    // things on the account and change nothing about the live line. This step is the one
    // that changes what happens when a real client dials the business, so it should only
    // run once there is something on the other end of the webhook to answer them with.
    if (!req.body?.assign_number) {
      steps.push({
        step: 'number routing',
        action: 'skipped — pass assign_number to do this once the call handler is live',
      });
      return res.json({
        ok: true, webhook, assigned: false,
        outbound_voice_profile_id: profile.id, call_control_application_id: app.id, steps,
      });
    }

    const numbers = await telnyx('/phone_numbers?page[size]=50');
    const number = (numbers.data || []).find(n => n.phone_number === process.env.TELNYX_FROM_NUMBER);
    if (!number) throw new Error(`${process.env.TELNYX_FROM_NUMBER} is not on this Telnyx account`);
    if (number.connection_id === app.id) {
      steps.push({ step: 'number routing', action: 'already pointed at the app', number: number.phone_number });
    } else {
      await telnyxWrite(`/phone_numbers/${number.id}`, 'PATCH', { connection_id: app.id });
      steps.push({
        step: 'number routing',
        action: 'pointed at the app',
        number: number.phone_number,
        was: number.connection_id || '(nothing — calls to it went nowhere)',
      });
    }

    res.json({
      ok: true,
      webhook,
      outbound_voice_profile_id: profile.id,
      call_control_application_id: app.id,
      steps,
    });
  } catch (e) {
    console.error('[voice] setup failed:', e.message);
    // Report what did succeed. A half-finished setup is re-runnable, but only if it is
    // clear which half finished.
    res.status(500).json({ error: e.message, steps });
  }
});

module.exports = router;
