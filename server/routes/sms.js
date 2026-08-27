// Staff-facing SMS inbox API. Backs the "Texts" screen: list conversations, read one thread
// (marking it read), and send a reply through the shared Telnyx send path.
//
// requireAuth (below) + the app-level denyInstructor guard keep this staff-only.

const express = require('express');
const pool = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const store = require('../lib/smsStore');
const { sendSMS, toE164 } = require('../lib/telnyxSend');
const { lookupPerson } = require('../lib/telnyxInbound');

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

router.get('/thread/:phone', async (req, res) => {
  try {
    const phone = toE164(req.params.phone);
    const messages = await store.listThread(phone);
    await store.markRead(phone);
    res.json({ phone, messages });
  } catch (e) {
    console.error('[sms] thread failed:', e.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// People she can text: clients + instructors that have a phone on file. Used by the compose
// picker (one-to-one) and the announcement audience count.
router.get('/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, phone, 'client' AS kind FROM clients
        WHERE coalesce(phone,'') <> ''
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

router.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body || !String(body).trim()) {
    return res.status(400).json({ error: 'A number and a message are required.' });
  }
  const text = String(body).trim();
  try {
    const phone = toE164(to);
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

module.exports = router;
