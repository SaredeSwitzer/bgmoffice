const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

// The production site — used to build the signing link sent by email. Overridable via env
// for anywhere that isn't the live domain.
const APP_URL = process.env.PUBLIC_APP_URL || 'https://bgmoffice.com';

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Public — no auth, keyed on an unguessable token ────────────────────────────

router.get('/public/:token', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT name, contract_text, signed_name, signed_at FROM instructor_contract_signatures WHERE token = $1',
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    name: row.name,
    contract_text: row.contract_text,
    already_signed: !!row.signed_at,
    signed_name: row.signed_name,
    signed_at: row.signed_at,
  });
});

router.post('/public/:token/sign', async (req, res) => {
  const { signed_name } = req.body;
  if (!signed_name?.trim()) return res.status(400).json({ error: 'Please type your full name to sign.' });

  const { rows: [row] } = await pool.query(
    'SELECT id, signed_at FROM instructor_contract_signatures WHERE token = $1',
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.signed_at) return res.status(400).json({ error: 'This contract has already been signed.' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const { rows: [updated] } = await pool.query(
    `UPDATE instructor_contract_signatures
       SET signed_name = $1, signed_at = now(), ip_address = $2
     WHERE id = $3
     RETURNING signed_at`,
    [signed_name.trim(), ip || null, row.id]
  );
  res.json({ ok: true, signed_at: updated.signed_at });
});

// ── Staff — send the signing link, review who's signed ─────────────────────────

router.use(requireAuth);

router.post('/invite/preview', requireStaff, async (req, res) => {
  const { name, email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const { rows: [contractRow] } = await pool.query(
    "SELECT value FROM app_settings WHERE key = 'instructor_contract_text'"
  );
  const contractText = contractRow?.value || '';
  if (!contractText) return res.status(400).json({ error: 'No contract text set up yet.' });

  const token = crypto.randomBytes(16).toString('hex');
  const { rows: [row] } = await pool.query(
    `INSERT INTO instructor_contract_signatures (name, email, token, contract_text)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [(name || '').trim() || null, email.trim(), token, contractText]
  );
  const link = `${APP_URL}/sign-contract/${token}`;
  const fillName = (name || '').trim() || 'there';

  const { rows: settingsRows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('instructor_contract_invite_subject','instructor_contract_invite_body')"
  );
  const m = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const fill = (str) => (str || '').replace(/\{name\}/g, fillName).replace(/\{link\}/g, link);
  const subject = fill(m.instructor_contract_invite_subject || 'Bring the Gym to Me — Instructor Contract');
  const body = fill(m.instructor_contract_invite_body ||
    `Hi {name},\n\nWelcome aboard! Please review and sign the instructor contract here:\n\n{link}\n\nLet us know if you have any questions.`);

  res.json({ signature_id: row.id, subject, body });
});

router.post('/invite/:id/send', requireStaff, async (req, res) => {
  const { email, subject, body } = req.body;
  if (!email || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Email, subject, and message are required' });
  }
  const { rows: [row] } = await pool.query(
    'SELECT id FROM instructor_contract_signatures WHERE id = $1', [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  try {
    await sendMail({ to: email, subject: subject.trim(), text: body });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query('UPDATE instructor_contract_signatures SET sent_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ok: true, sent_to: email });
});

// List signatures, most recent first — so staff can see who's signed and link them to an
// instructor record. Signing a contract never creates an instructor row on its own.
router.get('/signatures', requireStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.email, s.signed_name, s.signed_at, s.sent_at, s.instructor_id, i.name AS instructor_name
       FROM instructor_contract_signatures s
       LEFT JOIN instructors i ON i.id = s.instructor_id
      ORDER BY s.created_at DESC LIMIT 100`
  );
  res.json(rows);
});

router.post('/signatures/:id/link', requireStaff, async (req, res) => {
  const { instructor_id } = req.body;
  if (!instructor_id) return res.status(400).json({ error: 'instructor_id required' });
  const { rows: [sig] } = await pool.query(
    'SELECT id, signed_at FROM instructor_contract_signatures WHERE id = $1', [req.params.id]
  );
  if (!sig) return res.status(404).json({ error: 'Signature not found' });
  if (!sig.signed_at) return res.status(400).json({ error: 'This contract has not been signed yet.' });

  await pool.query('UPDATE instructor_contract_signatures SET instructor_id = $1 WHERE id = $2', [instructor_id, req.params.id]);
  await pool.query(
    'UPDATE instructors SET contract_signed = 1, contract_signed_date = $1 WHERE id = $2',
    [sig.signed_at, instructor_id]
  );
  res.json({ ok: true });
});

module.exports = router;
