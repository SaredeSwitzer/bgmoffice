const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');
const { encryptSSN, last4 } = require('../lib/ssnCrypto');

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
  const { signed_name, ssn, tax_id_type } = req.body;
  if (!signed_name?.trim()) return res.status(400).json({ error: 'Please type your full name to sign.' });

  // Incorporated instructors file under an EIN instead of a personal SSN. Same column,
  // same encryption — taxIdType just records which one they gave us.
  const taxIdType = tax_id_type === 'ein' ? 'ein' : 'ssn';

  const { rows: [row] } = await pool.query(
    'SELECT id, signed_at, instructor_id FROM instructor_contract_signatures WHERE token = $1',
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.signed_at) return res.status(400).json({ error: 'This contract has already been signed.' });

  // Encrypted immediately — the plaintext SSN never gets written to the database, only
  // to the app_settings-independent encrypted blob plus its last 4 digits for display.
  const ssnEncrypted = ssn?.trim() ? encryptSSN(ssn.trim()) : null;
  const ssnLast4 = ssn?.trim() ? last4(ssn) : null;

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const { rows: [updated] } = await pool.query(
    `UPDATE instructor_contract_signatures
       SET signed_name = $1, signed_at = now(), ip_address = $2, ssn_encrypted = $3, ssn_last4 = $4,
           tax_id_type = $5
     WHERE id = $6
     RETURNING signed_at`,
    [signed_name.trim(), ip || null, ssnEncrypted, ssnLast4, taxIdType, row.id]
  );

  // If this invite was sent from an existing instructor's profile (instructor_id was
  // known up front, not matched later), flip their record over immediately — same
  // fields POST /signatures/:id/link sets, just without staff having to do that
  // matching step by hand.
  if (row.instructor_id) {
    await pool.query(
      `UPDATE instructors SET contract_signed = 1, contract_signed_date = $1,
         ssn_encrypted = COALESCE($2, ssn_encrypted), ssn_last4 = COALESCE($3, ssn_last4),
         tax_id_type = CASE WHEN $2::text IS NULL THEN tax_id_type ELSE $4 END
       WHERE id = $5`,
      [updated.signed_at, ssnEncrypted, ssnLast4, taxIdType, row.instructor_id]
    );
  }

  res.json({ ok: true, signed_at: updated.signed_at });
});

// ── Staff — send the signing link, review who's signed ─────────────────────────

router.use(requireAuth);

router.post('/invite/preview', requireStaff, async (req, res) => {
  const { name, email, instructor_id } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const { rows: [contractRow] } = await pool.query(
    "SELECT value FROM app_settings WHERE key = 'instructor_contract_text'"
  );
  const contractText = contractRow?.value || '';
  if (!contractText) return res.status(400).json({ error: 'No contract text set up yet.' });

  const token = crypto.randomBytes(16).toString('hex');
  // instructor_id set here (sent from an existing instructor's profile) means the
  // signature auto-links and flips their record to "signed" the moment they sign —
  // see POST /public/:token/sign. Left null for the general "Send Contract to Sign"
  // flow, which still requires the manual match-up in the signatures list.
  const { rows: [row] } = await pool.query(
    `INSERT INTO instructor_contract_signatures (name, email, token, contract_text, instructor_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [(name || '').trim() || null, email.trim(), token, contractText, instructor_id || null]
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
// Dismissed rows (staff has seen/handled them) are left out — see POST .../dismiss.
router.get('/signatures', requireStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.email, s.signed_name, s.signed_at, s.sent_at, s.instructor_id, s.ssn_last4, s.tax_id_type, i.name AS instructor_name
       FROM instructor_contract_signatures s
       LEFT JOIN instructors i ON i.id = s.instructor_id
      WHERE s.dismissed_at IS NULL
      ORDER BY s.created_at DESC LIMIT 100`
  );
  res.json(rows);
});

// Hide a signature from the list once staff have seen/handled it — doesn't delete
// anything, just stops it showing up again.
router.post('/signatures/:id/dismiss', requireStaff, async (req, res) => {
  const result = await pool.query(
    'UPDATE instructor_contract_signatures SET dismissed_at = now() WHERE id = $1', [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Signature not found' });
  res.json({ ok: true });
});

router.post('/signatures/:id/link', requireStaff, async (req, res) => {
  const { instructor_id } = req.body;
  if (!instructor_id) return res.status(400).json({ error: 'instructor_id required' });
  const { rows: [sig] } = await pool.query(
    'SELECT id, signed_at, ssn_encrypted, ssn_last4, tax_id_type FROM instructor_contract_signatures WHERE id = $1', [req.params.id]
  );
  if (!sig) return res.status(404).json({ error: 'Signature not found' });
  if (!sig.signed_at) return res.status(400).json({ error: 'This contract has not been signed yet.' });

  await pool.query('UPDATE instructor_contract_signatures SET instructor_id = $1 WHERE id = $2', [instructor_id, req.params.id]);
  await pool.query(
    `UPDATE instructors SET contract_signed = 1, contract_signed_date = $1,
       ssn_encrypted = COALESCE($2, ssn_encrypted), ssn_last4 = COALESCE($3, ssn_last4),
       tax_id_type = CASE WHEN $2::text IS NULL THEN tax_id_type ELSE $4 END
     WHERE id = $5`,
    [sig.signed_at, sig.ssn_encrypted, sig.ssn_last4, sig.tax_id_type || 'ssn', instructor_id]
  );
  res.json({ ok: true });
});

module.exports = router;
