// Staff-facing SMS inbox API. Backs the "Texts" screen: list conversations, read one thread
// (marking it read), and send a reply through the shared Telnyx send path.
//
// requireAuth (below) + the app-level denyInstructor guard keep this staff-only.

const express = require('express');
const pool = require('../db/pg');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const store = require('../lib/smsStore');
const { sendSMS, toE164 } = require('../lib/telnyxSend');
const { lookupPerson } = require('../lib/telnyxInbound');
const { buildWeeklyReminders } = require('../lib/weeklyReminders');
const { buildPayoutReminders } = require('../lib/payoutReminders');
const { buildInstructorNudges } = require('../lib/instructorNudges');
const { findPeopleInText } = require('../lib/detectPeopleInText');
const { sendMail } = require('../lib/mailer');
const { explainSmsFailure } = require('../lib/smsFailureReason');
// Calls share the same phone key texts use, which is what lets the two be shown together.
const voiceStore = require('../lib/voiceStore');
const { saveContact, suggestMatches, whoHasNumber } = require('../lib/saveContact');
const { callOnlyNumberLookup } = require('../lib/clientTexting');

const router = express.Router();
router.use(requireAuth);

router.get('/threads', async (req, res) => {
  try {
    res.json(await store.listThreads());
  } catch (e) {
    console.error('[sms] threads failed:', e.message);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// How many texts are sitting unread, for the bell in the top bar. Polled from every page,
// so it stays one cheap count rather than loading the whole inbox.
router.get('/unread-count', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      SELECT count(*)::int AS unread,
             count(DISTINCT phone)::int AS threads,
             max(created_at) AS latest
        FROM sms_messages
       WHERE direction = 'inbound' AND read_at IS NULL`);
    res.json(row);
  } catch (e) {
    console.error('[sms] unread count failed:', e.message);
    // A broken count must not put an error banner on every screen in the app.
    res.json({ unread: 0, threads: 0, latest: null });
  }
});

router.get('/thread/:phone', async (req, res) => {
  try {
    const phone = toE164(req.params.phone);
    const messages = await store.listThread(phone);
    await store.markRead(phone);
    // A failed message carries the carrier's own wording, which is written for a
    // developer. Explain it in the thread, where the question "did she get this?"
    // actually gets asked.
    res.json({
      phone,
      messages: messages.map(m => {
        if (m.status !== 'delivery_failed') return m;
        const { plain, fix } = explainSmsFailure(m.error_detail, m.error_code);
        return { ...m, reason: plain, suggestion: fix };
      }),
    });
  } catch (e) {
    console.error('[sms] thread failed:', e.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// One person's whole history on this line — texts and calls together, in order.
//
// A client texts, then rings, then leaves a message. Kept in separate lists that reads as
// three unrelated events; in one timeline it reads as what it is, one person trying to
// reach you. Calls come from the same `phone` key texts use, which is what makes them
// line up at all.
router.get('/thread/:phone/timeline', async (req, res) => {
  try {
    const phone = toE164(req.params.phone);
    const [messages, calls] = await Promise.all([
      store.listThread(phone),
      voiceStore.listCallsFor(phone, 100),
    ]);

    const items = [
      ...messages.map(m => {
        const failed = m.status === 'delivery_failed';
        const { plain, fix } = failed ? explainSmsFailure(m.error_detail, m.error_code) : {};
        return { kind: 'text', at: m.created_at, ...m, reason: plain, suggestion: fix };
      }),
      ...calls.map(c => ({
        kind: 'call',
        at: c.started_at,
        id: `call-${c.id}`,
        call_id: c.id,
        direction: c.direction,
        status: c.status,
        duration_seconds: c.duration_seconds,
        answered_by: c.answered_by,
        voicemail_url: c.voicemail_url,
        voicemail_seconds: c.voicemail_seconds,
        voicemail_heard_at: c.voicemail_heard_at,
        transcript: c.transcript,
        transcript_kind: c.transcript_kind,
        recording_url: c.recording_url,
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    await store.markRead(phone);
    res.json({ phone, items });
  } catch (e) {
    console.error('[sms] timeline failed:', e.message);
    res.status(500).json({ error: 'Failed to load that history' });
  }
});

// People she can text: clients + instructors that have a phone on file. Used by the compose
// picker (one-to-one) and the announcement audience count.
router.get('/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, client_text_phone(id) AS phone, 'client' AS kind FROM clients
        WHERE coalesce(client_text_phone(id),'') <> ''
      UNION ALL
      SELECT id, name, phone, 'instructor' AS kind FROM instructors
        WHERE coalesce(phone,'') <> ''
      ORDER BY name
    `);
    res.json(rows);
  } catch (e) {
    console.error('[sms] contacts failed:', e.message);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

// Who else this conversation is about — read out of the messages themselves.
//
// A Waiting On line is one thread of work and usually has two people on it: the person
// being texted, and whoever the text is about. "Can you cover Etty's class Tuesday?" sent
// to an instructor names the client right there. Only ever a suggestion; the screen shows
// the name and lets it be changed or dropped.
router.get('/thread/:phone/about', async (req, res) => {
  try {
    const phone = toE164(req.params.phone);
    const messages = await store.listThread(phone);
    // The recent end of the conversation — an old message is about old business.
    const recent = messages.slice(-6).map(m => m.body || '').join('\n');
    const kinds = req.query.exclude_kind === 'client' ? ['instructor']
      : req.query.exclude_kind === 'instructor' ? ['client']
      : ['client', 'instructor'];
    const found = await findPeopleInText(recent, { kinds });
    res.json(found.slice(0, 3));
  } catch (e) {
    console.error('[sms] could not read who a thread is about:', e.message);
    res.json([]);   // a suggestion failing must never block texting
  }
});

// Search the text archive — by words, or by who you texted.
//
// Google Voice's search is the model she asked for: one box, and it finds both the
// conversation and the message inside it. Kept as two labelled lists rather than one
// blended one, because "Chaya Retek" the person and a message that happens to mention
// Chaya are different answers and you usually know which one you came for.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ q, people: [], messages: [] });
  try {
    const [people, messages] = await Promise.all([
      store.searchPeople(q),
      store.searchMessages(q),
    ]);
    res.json({ q, people, messages });
  } catch (e) {
    console.error('[sms] search failed:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});


// Texts that never arrived, with a plain-English reason. Drives the banner on the Texts
// screen — a failure that only exists inside one conversation is a failure nobody sees.
router.get('/failures', async (req, res) => {
  try {
    const rows = await store.recentFailures();
    res.json(rows.map(r => {
      const { plain, fix } = explainSmsFailure(r.error_detail, r.error_code);
      return { ...r, reason: plain, suggestion: fix };
    }));
  } catch (e) {
    console.error('[sms] could not load failed texts:', e.message);
    res.status(500).json({ error: 'Could not load failed texts' });
  }
});

// "I've seen these." Clears the banner without erasing anything: the failure stays on the
// message in the conversation, and a NEW failure brings the banner straight back.
router.post('/failures/dismiss', async (req, res) => {
  try {
    const cleared = await store.acknowledgeFailures(req.user.initials);
    res.json({ cleared });
  } catch (e) {
    console.error('[sms] could not dismiss failed texts:', e.message);
    res.status(500).json({ error: 'Could not dismiss those' });
  }
});

// Go back and ask Telnyx why the older failures failed.
//
// Failures before 2026-09-15 were announced and then forgotten — the reason was never
// written down, so they all read as the generic "the carrier wouldn't deliver this".
// Telnyx still holds the record against the message id we stored, so the real reason is
// recoverable rather than lost. Admin-only and read-then-write; it fills in blanks and
// never overwrites a reason we already have.
router.post('/failures/recover', requireAdmin, async (req, res) => {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return res.status(503).json({ error: 'TELNYX_API_KEY is not set' });
  try {
    const { rows } = await pool.query(
      `SELECT id, telnyx_id, phone, person_name FROM sms_messages
        WHERE direction = 'outbound' AND status = 'delivery_failed'
          AND coalesce(error_detail,'') = '' AND telnyx_id IS NOT NULL`);

    const results = [];
    for (const m of rows) {
      try {
        const r = await fetch(`https://api.telnyx.com/v2/messages/${m.telnyx_id}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { results.push({ id: m.id, ok: false, error: `Telnyx ${r.status}` }); continue; }

        const d = data?.data || {};
        const errs = d.errors || d.to?.[0]?.errors || [];
        const detail = Array.isArray(errs) && errs.length
          ? errs.map(e => e.detail || e.title || e.code).join('; ')
          : null;
        const code = Array.isArray(errs) && errs.length ? String(errs[0].code || '') : null;

        if (!detail) { results.push({ id: m.id, ok: false, error: 'Telnyx kept no reason for this one' }); continue; }
        await pool.query(
          'UPDATE sms_messages SET error_code = $2, error_detail = $3 WHERE id = $1',
          [m.id, code, detail]);
        const { plain } = explainSmsFailure(detail, code);
        results.push({ id: m.id, ok: true, who: m.person_name || m.phone, detail, reason: plain });
      } catch (e) {
        results.push({ id: m.id, ok: false, error: e.message });
      }
    }
    res.json({ checked: rows.length, recovered: results.filter(r => r.ok).length, results });
  } catch (e) {
    console.error('[sms] failure recovery failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── Payout reminders ─────────────────────────────────────────────────────────────────
// "Who taught last week that I haven't paid, and nudge them to send their request."
// Preview-first like the class reminders: nothing sends until she has read the list.
router.get('/payout-reminders', async (req, res) => {
  try {
    const { start, end } = req.query;
    res.json(await buildPayoutReminders(start && end ? { start, end } : {}));
  } catch (e) {
    console.error('[sms] payout reminder preview failed:', e.message);
    res.status(500).json({ error: 'Could not work out who is still owed' });
  }
});

// "Who isn't using BGM Office — never logged in, or no/stale availability — and nudge them."
// scope=upcoming (has a class in the next `weeks` weeks, default) or scope=all.
router.get('/instructor-nudges', async (req, res) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'upcoming';
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12);
    const staleDays = Math.min(Math.max(Number(req.query.stale_days) || 28, 7), 365);
    res.json(await buildInstructorNudges({ scope, weeks, staleDays }));
  } catch (e) {
    console.error('[sms] instructor nudge preview failed:', e.message);
    res.status(500).json({ error: 'Could not work out who needs a nudge' });
  }
});

router.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body || !String(body).trim()) {
    return res.status(400).json({ error: 'A number and a message are required.' });
  }
  const text = String(body).trim();
  try {
    const phone = toE164(to);

    // Stop a text to a number the client only takes calls at. Checked here rather than
    // only in the picker, because the number can also be typed in by hand — and the
    // failure it prevents is a silent one: a text to a landline is accepted by Telnyx and
    // simply never arrives, so without this nobody finds out for a week.
    const callOnly = await callOnlyNumberLookup(phone);
    if (callOnly) {
      return res.status(400).json({
        error: callOnly.reason,
        call_only: true,
        client_name: callOnly.client_name,
        texting_number: callOnly.texting_number,
      });
    }

    const person = await lookupPerson(phone);
    const sent = await sendSMS({ to: phone, text });
    const row = await store.logMessage({
      direction: 'outbound',
      phone,
      from_number: process.env.TELNYX_FROM_NUMBER || null,
      to_number: phone,
      body: text,
      telnyx_id: sent?.id || null,
      status: sent?.to?.[0]?.status || 'queued',
      person_id: person?.id,
      person_kind: person?.kind,
      person_name: person?.name,
    });
    res.json(row);
  } catch (e) {
    console.error('[sms] send failed:', e.message);
    res.status(500).json({ error: e.message || 'Failed to send text' });
  }
});

// ── Weekly class reminders ───────────────────────────────────────────────────────────
// Preview is read-only and safe to call repeatedly; sending is a separate explicit step
// so staff always sees exactly who gets what before anything leaves.
//
// Most reminders go by text. People with no phone on file go by email instead (the builder
// decides which, and says so in the preview) — before that they were flagged and dropped,
// which meant the ones nobody chased by hand got no reminder at all.

// The reminder body is plain text written for a text message. In an email it still reads
// naturally, but the line breaks have to be turned into real ones or the whole schedule
// collapses into one paragraph.
function reminderHtml(body) {
  const esc = String(body)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;` +
         `font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap">${esc}</div>`;
}

async function sendReminderEmail(m) {
  await sendMail({
    to: m.to,
    subject: m.subject?.trim() || 'Your classes this week — Bring the Gym to Me',
    text: m.body.trim(),
    html: reminderHtml(m.body.trim()),
  });
}

router.get('/weekly-reminders', async (req, res) => {
  try {
    const { start, end } = req.query;
    res.json(await buildWeeklyReminders(start && end ? { start, end } : {}));
  } catch (e) {
    console.error('[sms] weekly reminder preview failed:', e.message);
    res.status(500).json({ error: 'Failed to build the weekly reminders' });
  }
});

// Sends a prepared batch of messages, each already addressed and worded by whichever
// preview built it. Named for the class reminders because they came first; the payout
// reminders send through the very same path, which is why it also answers to /send-batch.
async function sendPreparedBatch(req, res) {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Nothing to send.' });
  }
  // Sent one at a time rather than in parallel: a partial failure has to be reportable
  // per-person, and Amber's history here is a run that silently delivered nothing while
  // reporting success. Every result is echoed back, failures included.
  const results = [];
  for (const m of messages) {
    if (!m?.to || !m?.body?.trim()) {
      results.push({ to: m?.to || null, name: m?.name || null, ok: false, error: 'Missing address or message' });
      continue;
    }
    try {
      // Email recipients never touch the SMS path — no E.164, no Telnyx, and nothing
      // written to the Texts inbox, which only holds actual texts.
      if (m.channel === 'email') {
        await sendReminderEmail(m);
        results.push({ to: m.to, name: m.name || null, ok: true, channel: 'email' });
        continue;
      }
      const phone = toE164(m.to);
      const person = await lookupPerson(phone);
      const sent = await sendSMS({ to: phone, text: m.body.trim() });
      await store.logMessage({
        direction: 'outbound',
        phone,
        from_number: process.env.TELNYX_FROM_NUMBER || null,
        to_number: phone,
        body: m.body.trim(),
        telnyx_id: sent?.id || null,
        status: sent?.to?.[0]?.status || 'queued',
        person_id: person?.id,
        person_kind: person?.kind,
        person_name: person?.name || m.name,
      });
      results.push({ to: phone, name: m.name || person?.name || null, ok: true, channel: 'sms' });
    } catch (e) {
      console.error(`[sms] weekly reminder to ${m.to} failed:`, e.message);
      results.push({ to: m.to, name: m.name || null, ok: false, error: e.message, channel: m.channel === 'email' ? 'email' : 'sms' });
    }
  }
  const sent = results.filter(r => r.ok).length;
  res.json({ sent, failed: results.length - sent, results });
}

router.post('/weekly-reminders/send', sendPreparedBatch);
router.post('/send-batch', sendPreparedBatch);


// ── Putting a name to an unknown number ──────────────────────────────────────────────
//
// See lib/saveContact.js for why this is three different things wearing one button.

// Who might this be? Offered before anything is created, because duplicate instructors
// have been a real clean-up job here more than once.
router.get('/who-is', async (req, res) => {
  try {
    const [already, matches] = await Promise.all([
      whoHasNumber(req.query.phone),
      suggestMatches(req.query.name),
    ]);
    res.json({ already, matches });
  } catch (e) {
    console.error('[sms] who-is failed:', e.message);
    res.json({ already: null, matches: [] });
  }
});

router.post('/save-contact', async (req, res) => {
  try {
    const r = await saveContact({ ...req.body, initials: req.user.initials });
    res.json(r);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Could not save that.' });
  }
});

module.exports = router;
