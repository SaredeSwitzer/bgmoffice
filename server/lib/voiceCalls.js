// Incoming and outgoing calls on the BGM line.
//
// Registered in app.js with a RAW body parser and BEFORE express.json(), for the same
// reason the SMS webhook is: the Ed25519 signature is over the exact bytes Telnyx sent.
//
// What happens when a client calls 917-719-2201:
//
//   1. Telnyx hands the call to us (call.initiated).
//   2. We answer it, so we have a leg we can connect things to.
//   3. We ring everyone who is on duty at once — each person's browser, each person's
//      cell, whatever they have turned on in their own settings.
//   4. The first person to pick up gets bridged to the caller, and every other phone
//      stops ringing.
//   5. Whatever happens, it lands in the call log against that person's contact, so the
//      call sits next to their texts.
//
// Ringing everyone at once rather than in order is deliberate: there is no sensible
// ranking of three assistants, and a sequence means the caller waits through each one
// timing out before the next phone even starts.

const pool = require('../db/pg');
const { verifySignature, lookupPerson } = require('./telnyxInbound');
const { toE164 } = require('./telnyxSend');
const store = require('./voiceStore');

const TELNYX = 'https://api.telnyx.com/v2';

// How long to let phones ring before giving up on the call.
const RING_SECONDS = 25;

async function command(callControlId, action, body = {}) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX}/calls/${callControlId}/actions/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.errors?.[0];
    throw new Error(err?.detail || err?.title || `Telnyx ${action} failed (${res.status})`);
  }
  return data.data;
}

async function dial(body) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX}/calls`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.errors?.[0];
    throw new Error(err?.detail || err?.title || `Telnyx dial failed (${res.status})`);
  }
  return data.data;
}

// client_state is how a leg remembers what it is for. Telnyx hands it back on every event
// for that leg, and it must be base64.
const encodeState = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
function decodeState(s) {
  if (!s) return {};
  try { return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); } catch { return {}; }
}

// ── Ringing everyone ─────────────────────────────────────────────────────────────────

// One outbound leg per phone that should ring. Each leg carries the id of the call it is
// trying to answer, so whoever picks up can be bridged to the right caller.
async function ringEveryone(parentCcid, callerNumber, connectionId) {
  const targets = await store.ringTargets();
  if (targets.length === 0) {
    console.warn('[voice] a call came in and nobody is set up to be rung');
    return 0;
  }

  // Last ten digits, so a cell stored as +1214… still matches a caller id of 214….
  const callerKey = String(callerNumber || '').replace(/\D/g, '').slice(-10);

  let rung = 0;
  for (const t of targets) {
    // A person can have both on, and then both ring — that is the point of it.
    const destinations = [];
    if (t.ring_browser && t.sip_username) destinations.push(`sip:${t.sip_username}@sip.telnyx.com`);

    // Never ring the phone the call is coming FROM. Staff do call the office line from
    // their own cells, and dialling that cell back gets them a call-waiting beep from
    // themselves — or nothing, since carriers tend to refuse a call that claims to come
    // from the number it is calling. Their browser still rings, which is the point.
    const cellKey = String(t.cell_phone || '').replace(/\D/g, '').slice(-10);
    const isTheCaller = callerKey && cellKey && callerKey === cellKey;
    if (t.ring_cell && t.cell_phone && !isTheCaller) destinations.push(toE164(t.cell_phone));

    for (const to of destinations) {
      try {
        const leg = await dial({
          connection_id: connectionId,
          to,
          // Must be a number this Telnyx account owns. Putting the caller's own number
          // here — so a staff cell would show who was really calling — looks reasonable
          // and is rejected outright: every leg was hung up within milliseconds, which
          // read like "nobody answered" rather than "this was never allowed".
          from: process.env.TELNYX_FROM_NUMBER,
          // The caller's identity still travels, just as a display name instead.
          from_display_name: String(callerNumber || '').slice(0, 128) || undefined,
          timeout_secs: RING_SECONDS,
          client_state: encodeState({ role: 'ring', parent: parentCcid, user_id: t.user_id, who: t.initials }),
        });
        await store.startCall({
          call_control_id: leg.call_control_id,
          call_session_id: leg.call_session_id,
          parent_call_control_id: parentCcid,
          direction: 'outbound',
          leg: 'ring',
          to_number: to,
          from_number: callerNumber,
          status: 'ringing',
        });
        rung += 1;
      } catch (e) {
        // One person's phone being unreachable must not stop the others ringing.
        console.error(`[voice] could not ring ${to}:`, e.message);
      }
    }
  }
  return rung;
}

// ── Outgoing: call someone from the office line ──────────────────────────────────────
//
// Used by the "ring my phone, then connect" path — the one that works from a cell with no
// app open. We call the staff member first; when they pick up, we dial the client and put
// the two together. The client sees the BGM number, never anybody's personal one.
async function placeBridgedCall({ staffNumber, toNumber, connectionId, who, person }) {
  const officeNumber = process.env.TELNYX_FROM_NUMBER;
  const target = toE164(toNumber);

  const leg = await dial({
    connection_id: connectionId,
    to: toE164(staffNumber),
    from: officeNumber,
    timeout_secs: RING_SECONDS,
    client_state: encodeState({ role: 'originator', to: target, who, person }),
  });

  await store.startCall({
    call_control_id: leg.call_control_id,
    call_session_id: leg.call_session_id,
    direction: 'outbound',
    leg: 'primary',
    from_number: officeNumber,
    to_number: target,
    phone: target,
    person_id: person?.id,
    person_kind: person?.kind,
    person_name: person?.name,
    status: 'ringing',
  });

  return leg;
}

// ── Voicemail ────────────────────────────────────────────────────────────────────────
// When every phone has stopped ringing and nobody took the call, ask the caller to leave
// a message rather than hanging up on them. A client who rings the business and is simply
// cut off has no idea whether they reached the right place at all.
//
// The greeting is editable — it is a thing customers hear, so it should not be locked
// inside the code. Falls back to a plain one if nothing has been set.
const DEFAULT_GREETING =
  "Thanks for calling Bring the Gym to Me. We can't take your call right now, " +
  'so please leave a message after the tone and we\'ll get back to you as soon as we can.';

async function voicemailGreeting() {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'voicemail_greeting'");
    if (rows[0]?.value?.trim()) return rows[0].value.trim();
  } catch { /* the greeting must never be the reason a call fails */ }
  return DEFAULT_GREETING;
}

async function sendToVoicemail(parentCcid) {
  // Stop the ringing tone first, or the greeting plays underneath it.
  await command(parentCcid, 'playback_stop', {}).catch(() => {});
  const payload = await voicemailGreeting();
  await command(parentCcid, 'speak', {
    payload,
    voice: 'female',
    language: 'en-US',
    // Recording starts when the greeting finishes, not before — otherwise the greeting
    // is the first thing on the recording.
    client_state: encodeState({ role: 'voicemail_greeting' }),
  });
}

// ── The webhook ──────────────────────────────────────────────────────────────────────

async function handleWebhook(req, res) {
  const rawBody = req.body; // Buffer (express.raw)
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY || '';

  if (publicKeyB64) {
    const ok = verifySignature({
      rawBody,
      signature: req.headers['telnyx-signature-ed25519'],
      timestamp: req.headers['telnyx-timestamp'],
      publicKeyB64,
    });
    if (!ok) {
      console.error('[voice] signature verification failed');
      return res.status(400).json({ error: 'invalid signature' });
    }
  } else {
    console.warn('[voice] TELNYX_PUBLIC_KEY not set — skipping signature verification');
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'bad json' }); }

  const type = event?.data?.event_type;
  const p = event?.data?.payload || {};

  // Telnyx retries anything that is not a prompt 200, and a retried call event is worse
  // than a dropped one — it re-rings phones. Acknowledge first, then do the work.
  res.json({ ok: true });

  try {
    await route(type, p);
  } catch (e) {
    console.error(`[voice] ${type} failed:`, e.message);
  }
}

async function route(type, p) {
  const state = decodeState(p.client_state);
  const ccid = p.call_control_id;

  switch (type) {
    case 'call.initiated': {
      // A call placed from somebody's browser. It goes straight out through the softphone
      // connection rather than through us, so this event is the only chance to record it —
      // without this, calls made from the app were simply absent from the call log.
      //
      // Legs we dial ourselves are also "outgoing"; they carry a client_state and are
      // logged where they are created, so having none is what marks this as the browser's.
      if (p.direction === 'outgoing' && !p.client_state) {
        const dialled = toE164(p.to);
        const person = await lookupPerson(dialled).catch(() => null);
        await store.startCall({
          call_control_id: ccid,
          call_session_id: p.call_session_id,
          direction: 'outbound',
          leg: 'primary',
          from_number: p.from,
          to_number: dialled,
          phone: dialled,
          person_id: person?.id,
          person_kind: person?.kind,
          person_name: person?.name,
          status: 'ringing',
        });
        return;
      }

      // Only inbound calls need answering here. Legs we dialled ourselves report
      // call.initiated too, and answering those would be answering our own phone.
      if (p.direction !== 'incoming') return;

      // And it must be a call to the office number, not one of our own legs on its way
      // to a staff browser.
      //
      // A leg we dial to sip:gencred…@sip.telnyx.com arrives at the softphone connection,
      // whose webhook is also this endpoint — so Telnyx reports it as an *incoming* call
      // too. Treating that as a fresh office call meant answering it and ringing everyone
      // again, and each of those legs came back round as another incoming call. One real
      // call from a cell turned into six, and only stopped because the browsers refused
      // the extras. Left alone it is a loop that dials in circles and bills for it.
      if (toE164(p.to) !== toE164(process.env.TELNYX_FROM_NUMBER)) {
        return;
      }

      const caller = toE164(p.from);
      const person = await lookupPerson(caller).catch(() => null);

      await store.startCall({
        call_control_id: ccid,
        call_session_id: p.call_session_id,
        direction: 'inbound',
        leg: 'primary',
        from_number: caller,
        to_number: p.to,
        phone: caller,
        person_id: person?.id,
        person_kind: person?.kind,
        person_name: person?.name,
        status: 'ringing',
      });

      await command(ccid, 'answer', {
        client_state: encodeState({ role: 'inbound' }),
      });
      return;
    }

    case 'call.answered': {
      // A browser-placed call being picked up at the far end. No role of ours, but it is
      // in the log and should show as answered rather than sitting on "ringing" forever.
      if (!state.role) {
        await store.markAnswered(ccid, null);
        return;
      }

      // Our inbound leg just picked up — now go find a human for it.
      if (state.role === 'inbound') {
        // We answer first and only then go looking for a human, which leaves the caller
        // on an open, silent line for a few seconds — that dead air is what a caller
        // hears as "something is wrong with this number". Give them a normal ringing
        // tone while we hunt, and stop it the moment somebody picks up.
        await command(ccid, 'playback_start', {
          audio_url: `${process.env.PUBLIC_URL || 'https://bgmoffice.com'}/ringback.wav`,
          loop: 'infinity',
        }).catch((e) => console.error('[voice] no ringback:', e.message));

        const rung = await ringEveryone(ccid, toE164(p.from), p.connection_id);
        if (rung === 0) {
          // Nobody to ring. Better to end the call than leave someone on a silent line.
          await command(ccid, 'hangup', {}).catch(() => {});
        }
        return;
      }

      // A phone we were ringing picked up. Connect it to the caller and stop the rest.
      if (state.role === 'ring') {
        await store.markAnswered(ccid, state.who);
        await store.markAnswered(state.parent, state.who);
        // Stop the ringing tone before connecting them, or the caller hears it over the
        // top of the person who just picked up.
        await command(state.parent, 'playback_stop', {}).catch(() => {});
        await command(ccid, 'bridge', { call_control_id: state.parent });

        const others = await store.siblingLegs(state.parent, ccid);
        for (const leg of others) {
          await command(leg.call_control_id, 'hangup', {}).catch(() => {});
        }
        return;
      }

      // The staff member on an outgoing bridged call picked up — now dial who they
      // actually wanted, and put the two together when that side answers.
      if (state.role === 'originator') {
        await store.markAnswered(ccid, state.who);
        const leg = await dial({
          connection_id: p.connection_id,
          to: state.to,
          from: process.env.TELNYX_FROM_NUMBER,
          timeout_secs: RING_SECONDS,
          client_state: encodeState({ role: 'destination', parent: ccid }),
        });
        await store.startCall({
          call_control_id: leg.call_control_id,
          call_session_id: leg.call_session_id,
          parent_call_control_id: ccid,
          direction: 'outbound',
          leg: 'ring',
          from_number: process.env.TELNYX_FROM_NUMBER,
          to_number: state.to,
          status: 'ringing',
        });
        return;
      }

      if (state.role === 'destination') {
        await store.markAnswered(ccid, null);
        await command(ccid, 'bridge', { call_control_id: state.parent });
        return;
      }
      return;
    }

    case 'call.hangup': {
      // Why a leg ended is the whole diagnosis when a call does not connect, and it is
      // only ever on this event. Without it, a leg rejected outright and a phone nobody
      // picked up look identical in the log — both just "missed".
      if (p.hangup_cause && p.hangup_cause !== 'normal_clearing') {
        console.error(`[voice] leg ${ccid} ended: ${p.hangup_cause}` +
          `${p.sip_hangup_cause ? ` (SIP ${p.sip_hangup_cause})` : ''}` +
          `${state.role ? ` [${state.role}]` : ''}`);
      }
      await store.markEnded(ccid, null, p.hangup_cause, p.sip_hangup_cause);

      // The last phone we were ringing has given up. If the caller is still holding and
      // nobody took the call, offer voicemail instead of dropping them.
      if (state.role === 'ring' && state.parent) {
        const stillRinging = await store.siblingLegs(state.parent, ccid);
        if (stillRinging.length === 0) {
          const parent = await store.findByCallControlId(state.parent);
          // Only if they are still on the line and it was never picked up — a call that
          // was answered and has now ended must not be sent to voicemail.
          if (parent && !parent.answered_at && !parent.ended_at) {
            await sendToVoicemail(state.parent)
              .catch((e) => console.error('[voice] could not offer voicemail:', e.message));
          }
        }
      }

      // When the caller gives up, every phone still ringing for them should stop.
      if (state.role === 'inbound') {
        const others = await store.siblingLegs(ccid, null);
        for (const leg of others) {
          await command(leg.call_control_id, 'hangup', {}).catch(() => {});
        }
      }
      // And when the person who started an outgoing call hangs up before the other side
      // answers, do not leave that side ringing a phone nobody is holding.
      if (state.role === 'originator') {
        const others = await store.siblingLegs(ccid, null);
        for (const leg of others) {
          await command(leg.call_control_id, 'hangup', {}).catch(() => {});
        }
      }
      return;
    }

    // The greeting has finished playing — now actually take the message.
    case 'call.speak.ended': {
      if (state.role !== 'voicemail_greeting') return;
      await command(ccid, 'record_start', {
        format: 'mp3',
        channels: 'single',
        play_beep: true,
        // Long enough for a real message, short enough that an open line left off the
        // hook does not record for an hour.
        max_length: 180,
        client_state: encodeState({ role: 'voicemail_recording' }),
      }).catch((e) => console.error('[voice] could not start recording:', e.message));
      return;
    }

    case 'call.recording.saved': {
      const url = p.public_recording_urls?.mp3 || p.recording_urls?.mp3
        || p.public_recording_urls?.wav || p.recording_urls?.wav || null;
      if (!url) {
        console.error('[voice] a recording was saved but carried no url');
        return;
      }
      // Recorded against the call it belongs to, so it reads as "she rang and left this"
      // rather than as a loose audio file with a number attached.
      await store.saveVoicemail(ccid, url, p.recording_ended_at && p.recording_started_at
        ? Math.max(0, Math.round((new Date(p.recording_ended_at) - new Date(p.recording_started_at)) / 1000))
        : null);
      return;
    }

    case 'call.bridged':
      return;   // nothing to do; both legs are already marked answered

    default:
      return;
  }
}

module.exports = { handleWebhook, placeBridgedCall, dial, command, encodeState, decodeState, RING_SECONDS };
