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

  let rung = 0;
  for (const t of targets) {
    // A person can have both on, and then both ring — that is the point of it.
    const destinations = [];
    if (t.ring_browser && t.sip_username) destinations.push(`sip:${t.sip_username}@sip.telnyx.com`);
    if (t.ring_cell && t.cell_phone) destinations.push(toE164(t.cell_phone));

    for (const to of destinations) {
      try {
        const leg = await dial({
          connection_id: connectionId,
          to,
          // The caller's own number, so a cell shows who is actually calling rather than
          // showing the office calling itself.
          from: callerNumber,
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
      // Only inbound calls need answering here. Legs we dialled ourselves report
      // call.initiated too, and answering those would be answering our own phone.
      if (p.direction !== 'incoming') return;

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
      // Our inbound leg just picked up — now go find a human for it.
      if (state.role === 'inbound') {
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
      await store.markEnded(ccid, null);

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

    case 'call.bridged':
      return;   // nothing to do; both legs are already marked answered

    default:
      return;
  }
}

module.exports = { handleWebhook, placeBridgedCall, dial, command, encodeState, decodeState, RING_SECONDS };
