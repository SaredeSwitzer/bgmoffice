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
const store = require('../lib/voiceStore');
// The same people search the text inbox uses — one definition of "who is in the book".
const smsStore = require('../lib/smsStore');
const { placeBridgedCall, command } = require('../lib/voiceCalls');
const { lookupPerson } = require('../lib/telnyxInbound');
const { toE164 } = require('../lib/telnyxSend');

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

// The sign-in token for a browser phone is the one Telnyx endpoint that answers with the
// bare JWT as plain text rather than the usual {data: …} envelope. Parsing it as JSON
// yields nothing, quietly, with a 200 — so the browser got a token of `undefined` and
// simply failed to register with no error to show for it.
async function mintCredentialToken(credentialId) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX}/telephony_credentials/${credentialId}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Telnyx would not issue a phone token (${res.status})`);
  // Belt and braces, in case it is ever wrapped after all.
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      return j?.data?.token || j?.token || j?.data || text;
    } catch { /* fall through to the raw body */ }
  }
  if (!text) throw new Error('Telnyx returned an empty phone token');
  return text;
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
        // Reported because a browser cannot be rung at all unless this is on, and the
        // failure looks like "nobody answered" rather than like a setting being off.
        sip_uri_calling_preference: c.sip_uri_calling_preference,
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
// The SIP connection every staff browser signs in under. One connection, one credential
// per person beneath it, so an incoming call can ring one named person's browser.
const SOFTPHONE_NAME = 'BGM Office softphone';
// What the phone network shows when we ring somebody. Capped at 15 characters by the
// caller-ID-name system, so the full "Bring the Gym to Me" does not fit.
//
// It was registered as "Bring the Gym" on 2026-09-15 and REMOVED on 2026-09-16, because
// the two things it was asked to do cannot both happen on one number.
//
// Every phone we ring on an incoming call is dialled FROM this number — Telnyx will not
// dial from anything else — so the receiving carrier looks this number up and shows
// whatever name is registered against it. With a name registered, every incoming call
// announced itself as "Bring the Gym" instead of the person calling, on cells and in the
// app alike. Sarede's call: knowing who is ringing her matters more than branding calls
// she makes, especially as wireless carriers largely ignore caller-ID names anyway, so
// most clients never saw it.
//
// Getting both back would take a second number: one to call clients from, one to ring
// staff from. Don't re-enable this on the shared number without that.

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

    // 3. The SIP connection the browsers sign in under. Separate from the call control
    //    application because they are different kinds of thing to Telnyx: one receives
    //    calls from the outside world, the other is where our own softphones live.
    const conns = await telnyx('/credential_connections?page[size]=50');
    let softphone = (conns.data || []).find(c => c.connection_name === SOFTPHONE_NAME);
    if (softphone) {
      // A browser is reached by dialling its SIP address, and a connection refuses that
      // outright unless SIP URI calling is switched on — which is not the default. Every
      // attempt to ring a browser was rejected in milliseconds until this was set.
      //
      // "internal" and not "unrestricted": it lets our own call control application ring
      // a staff browser, because both live in this same Telnyx account, without also
      // letting anyone on the internet dial a staff member's SIP address directly.
      // Applied every run rather than only when it looks wrong. The list endpoint does
      // not return sip_uri_calling_preference at all, so "looks wrong" cannot be told
      // from "cannot see it" — and quietly skipping the fix on a field you cannot read
      // is how this stayed broken through a whole test call. The PATCH is idempotent.
      softphone = await telnyxWrite(`/credential_connections/${softphone.id}`, 'PATCH', {
        connection_name: SOFTPHONE_NAME,
        sip_uri_calling_preference: 'internal',
      });
      steps.push({
        step: 'softphone connection',
        action: 'SIP URI calling set',
        id: softphone.id,
        // Read back from Telnyx's own response, so this is what is really stored.
        sip_uri_calling_preference: softphone.sip_uri_calling_preference,
      });
    } else {
      softphone = await telnyxWrite('/credential_connections', 'POST', {
        connection_name: SOFTPHONE_NAME,
        // Only ever used to create the connection; nobody signs in with it. Each person
        // gets their own short-lived credential minted under it instead.
        user_name: `bgmoffice${Date.now().toString(36)}`,
        password: require('crypto').randomBytes(18).toString('base64url'),
        webhook_event_url: webhook,
        webhook_api_version: '2',
        // Without this a browser cannot be rung at all — see the note above.
        sip_uri_calling_preference: 'internal',
        outbound: { outbound_voice_profile_id: profile.id },
      });
      steps.push({ step: 'softphone connection', action: 'created', id: softphone.id });
    }

    // What people see when we ring them. Cleared deliberately — see the note at the top
    // of this file. Propagation across carriers takes days either way.
    try {
      // Match on the last ten digits, not on the string. These came back unequal once —
      // the stored number and Telnyx's own formatting differed by punctuation — and
      // because a miss was silent, setup reported success having changed nothing at all.
      const want = String(process.env.TELNYX_FROM_NUMBER || '').replace(/\D/g, '').slice(-10);
      const all = (await telnyx('/phone_numbers?page[size]=50')).data || [];
      const number = want
        ? all.find(n => String(n.phone_number || '').replace(/\D/g, '').slice(-10) === want)
        : null;
      if (!number) {
        steps.push({ step: 'caller ID name', action: `no match for ${process.env.TELNYX_FROM_NUMBER || '(no number set)'} among ${all.length} numbers on the account` });
      }
      if (number) {
        // Deliberately cleared, not merely left alone — see the note above. Setup is
        // re-run from time to time, so it has to actively undo a listing that may still
        // be registered from before rather than quietly leave it in place.
        await telnyxWrite(`/phone_numbers/${number.id}/voice`, 'PATCH', {
          caller_id_name_enabled: false,
          cnam_listing: { cnam_listing_enabled: false, cnam_listing_details: '' },
        });
        steps.push({ step: 'caller ID name', action: 'cleared, so incoming calls can show who is really calling' });
      }
    } catch (e) {
      steps.push({ step: 'caller ID name', action: `could not enable — ${e.message}` });
    }

    // 4. Point the number at it. Reversible: setting connection_id back to '' puts the
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
        outbound_voice_profile_id: profile.id, call_control_application_id: app.id,
        softphone_connection_id: softphone.id, steps,
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
      softphone_connection_id: softphone.id,
      steps,
    });
  } catch (e) {
    console.error('[voice] setup failed:', e.message);
    // Report what did succeed. A half-finished setup is re-runnable, but only if it is
    // clear which half finished.
    res.status(500).json({ error: e.message, steps });
  }
});

// ── Each person's own phone settings ─────────────────────────────────────────────────
// Not admin-only: every assistant decides for herself whether her computer rings, whether
// her cell rings, and what her cell number is. Nobody should have to ask to go off duty.

router.get('/me', async (req, res) => {
  try {
    const row = await store.getVoiceUser(req.user.id);
    res.json(row || { user_id: req.user.id, cell_phone: null, ring_browser: true, ring_cell: false });
  } catch (e) {
    console.error('[voice] could not read phone settings:', e.message);
    res.status(500).json({ error: 'Could not load your phone settings' });
  }
});

router.put('/me', async (req, res) => {
  try {
    const { cell_phone, ring_browser, ring_cell } = req.body || {};
    // Ringing a cell that is not on file would silently never ring. Say so instead.
    if (ring_cell && !cell_phone) {
      const existing = await store.getVoiceUser(req.user.id);
      if (!existing?.cell_phone) {
        return res.status(400).json({ error: 'Add your cell number first, then it can ring.' });
      }
    }
    res.json(await store.upsertVoiceUser(req.user.id, { cell_phone, ring_browser, ring_cell }, req.user.initials));
  } catch (e) {
    console.error('[voice] could not save phone settings:', e.message);
    res.status(500).json({ error: 'Could not save your phone settings' });
  }
});

// ── Signing this browser in as a phone ───────────────────────────────────────────────
// Mints a short-lived Telnyx credential for whoever is logged in. The browser uses it to
// register as a phone, which is what lets it both place calls and be rung.
router.post('/token', async (req, res) => {
  try {
    const conns = await telnyx('/credential_connections?page[size]=50');
    const softphone = (conns.data || []).find(c => c.connection_name === SOFTPHONE_NAME);
    if (!softphone) {
      return res.status(503).json({ error: 'Calling has not been set up on the phone account yet.' });
    }

    let row = await store.getVoiceUser(req.user.id);

    // One credential per person, reused. A new one per sign-in would change their SIP
    // name, and an incoming call rings a name — so it would stop reaching them.
    if (!row?.telnyx_credential_id) {
      const cred = await telnyxWrite('/telephony_credentials', 'POST', {
        connection_id: softphone.id,
        name: `BGM ${req.user.initials || req.user.id}`,
      });
      await store.saveCredential(req.user.id, cred.id, cred.sip_username);
      row = await store.getVoiceUser(req.user.id);
    }

    const token = await mintCredentialToken(row.telnyx_credential_id);
    res.json({
      token,
      sip_username: row.sip_username,
      caller_number: process.env.TELNYX_FROM_NUMBER,
    });
  } catch (e) {
    console.error('[voice] could not mint a browser phone token:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Calling someone without the browser ──────────────────────────────────────────────
// Rings the caller's own phone first; when they pick up, dials whoever they asked for and
// puts the two together. This is the path that works from a cell with nothing open.
router.post('/call', async (req, res) => {
  const { to } = req.body || {};
  if (!to) return res.status(400).json({ error: 'Who should we call?' });
  try {
    const me = await store.getVoiceUser(req.user.id);
    if (!me?.cell_phone) {
      return res.status(400).json({ error: 'Add your cell number in your phone settings first — that is the phone we ring.' });
    }

    const apps = await telnyx('/call_control_applications?page[size]=50');
    const app = (apps.data || []).find(a => a.application_name === APP_NAME);
    if (!app) return res.status(503).json({ error: 'Calling has not been set up on the phone account yet.' });

    const person = await lookupPerson(toE164(to)).catch(() => null);
    const leg = await placeBridgedCall({
      staffNumber: me.cell_phone,
      toNumber: to,
      connectionId: app.id,
      who: req.user.initials,
      person,
    });
    res.json({ ok: true, call_control_id: leg.call_control_id, ringing: me.cell_phone });
  } catch (e) {
    console.error('[voice] could not place the call:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// End a call we started. The "ring my phone, then connect you" path had no way to stop:
// once it was dialling there was nothing to press, so a call that reached voicemail or
// rang out just kept going until the far end gave up. Hanging up the leg we hold also
// takes down the leg bridged to it.
router.post('/calls/:ccid/hangup', async (req, res) => {
  try {
    await command(req.params.ccid, 'hangup', {});
    res.json({ ok: true });
  } catch (e) {
    // Already over is not a failure — the button should not report an error for a call
    // that ended a second before it was pressed.
    const gone = /not found|already|completed|hangup/i.test(e.message || '');
    if (gone) return res.json({ ok: true, already_ended: true });
    console.error('[voice] could not hang up:', e.message);
    res.status(500).json({ error: 'Could not end that call' });
  }
});

// Who is ringing right now, asked by the browser the moment a call comes in. See
// lib/voiceStore.js — the phone network can only tell the browser about the BGM number,
// not about the caller, so the name has to come from us.
router.get('/ringing', async (req, res) => {
  try {
    res.json(await store.ringingCaller() || {});
  } catch (e) {
    // Never fail the popup over this — it falls back to whatever name the network gave.
    console.error('[voice] could not look up the ringing caller:', e.message);
    res.json({});
  }
});

// A playable link for one call's recording or voicemail.
//
// The link that arrives with the recording is signed and expires ten minutes later, so
// the ones stored against older calls are all dead — which is why the play button did
// nothing. Asked for at the moment of playing instead, so it is always fresh.
//
// Falls back to searching by call session for recordings saved before we started keeping
// the id.
router.get('/calls/:id/recording', async (req, res) => {
  try {
    const row = await store.recordingHandle(req.params.id);
    if (!row) return res.status(404).json({ error: 'No such call' });

    let rec = null;
    if (row.recording_id) {
      rec = (await telnyx(`/recordings/${row.recording_id}`)).data;
    } else if (row.call_session_id) {
      const found = (await telnyx(`/recordings?filter[call_session_id]=${encodeURIComponent(row.call_session_id)}`)).data;
      rec = Array.isArray(found) ? found[0] : null;
      // Remember it, so the next play is one call instead of a search.
      if (rec?.id) await store.saveCallRecording(row.call_control_id, null, null, rec.id);
    }

    const url = rec?.download_urls?.mp3 || rec?.download_urls?.wav
      || rec?.recording_urls?.mp3 || rec?.recording_urls?.wav || null;
    if (!url) return res.status(404).json({ error: 'That recording is no longer available.' });
    res.json({ url });
  } catch (e) {
    console.error('[voice] could not fetch a recording:', e.message);
    res.status(500).json({ error: 'Could not fetch that recording.' });
  }
});

// ── The call log ─────────────────────────────────────────────────────────────────────

router.get('/calls', async (req, res) => {
  try {
    if (req.query.phone) return res.json(await store.listCallsFor(req.query.phone));

    const q = String(req.query.q || '').trim();
    const calls = await store.listCalls(100, q || null);
    if (q.length < 2) return res.json(calls);

    // Searching calls should find anyone in the book, not only people already called —
    // otherwise the one moment you most need to ring somebody new is the moment search
    // comes back empty. Reuses the same people search the text inbox uses, minus anyone
    // already showing in the results above.
    const seen = new Set(calls.map(c => String(c.phone || '').replace(/\D/g, '').slice(-10)));
    const people = (await smsStore.searchPeople(q))
      .filter(p => !seen.has(String(p.phone || '').replace(/\D/g, '').slice(-10)));

    res.json({ calls, people });
  } catch (e) {
    console.error('[voice] could not load the call log:', e.message);
    res.status(500).json({ error: 'Could not load calls' });
  }
});

// Marking a voicemail as heard, so a message nobody has listened to still stands out.
router.post('/calls/:id/heard', async (req, res) => {
  try {
    await store.markVoicemailHeard(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[voice] could not mark a voicemail heard:', e.message);
    res.status(500).json({ error: 'Could not update that message' });
  }
});

module.exports = router;
