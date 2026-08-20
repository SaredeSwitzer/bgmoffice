const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

const APP_URL = process.env.PUBLIC_APP_URL || 'https://bgmoffice.com';

async function getStripe() {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  const secretKey = row?.value || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return require('stripe')(secretKey);
}

// ── Public — no auth, keyed on an unguessable token ────────────────────────────

router.get('/public/:token', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT org_name, contact_name, email, phone, street, city, zip,
            contract_text, payment_terms_text, deposit_amount,
            signed_name, signed_at, deposit_paid_at
       FROM client_contract_signatures WHERE token = $1`,
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({
    org_name: row.org_name,
    contact_name: row.contact_name,
    email: row.email,
    phone: row.phone,
    street: row.street,
    city: row.city,
    zip: row.zip,
    contract_text: row.contract_text,
    payment_terms_text: row.payment_terms_text,
    deposit_amount: row.deposit_amount,
    already_signed: !!row.signed_at,
    signed_name: row.signed_name,
    signed_at: row.signed_at,
    deposit_paid: !!row.deposit_paid_at,
  });
});

// Creates (or reuses) the Stripe PaymentIntent for the deposit — same pattern as the
// invoice pay-by-link flow. Only called when the contract actually has a deposit_amount.
router.post('/public/:token/create-payment-intent', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM client_contract_signatures WHERE token = $1', [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.deposit_amount) return res.status(400).json({ error: 'No deposit due on this contract.' });
  if (row.deposit_paid_at) return res.status(409).json({ error: 'Deposit already paid.' });

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  try {
    let clientSecret = row.stripe_client_secret;
    if (row.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status)) {
        clientSecret = existing.client_secret;
      } else {
        clientSecret = null;
      }
    }
    if (!clientSecret) {
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(row.deposit_amount * 100),
        currency: 'usd',
        payment_method_types: ['card', 'us_bank_account'],
        receipt_email: row.email || undefined,
        metadata: { client_contract_signature_id: String(row.id) },
        description: `Deposit — ${row.org_name || row.contact_name || 'contract'}`,
      });
      await pool.query(
        'UPDATE client_contract_signatures SET stripe_payment_intent_id=$1, stripe_client_secret=$2 WHERE id=$3',
        [intent.id, intent.client_secret, row.id]
      );
      clientSecret = intent.client_secret;
    }
    res.json({ clientSecret });
  } catch (err) {
    console.error('[stripe] client contract paymentIntent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:token/sign', async (req, res) => {
  const { signed_name, contact_name, email, phone, org_name, street, city, zip } = req.body;
  if (!signed_name?.trim()) return res.status(400).json({ error: 'Please type your full name to sign.' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });

  const { rows: [row] } = await pool.query(
    'SELECT id, signed_at, deposit_amount, deposit_paid_at, client_id FROM client_contract_signatures WHERE token = $1',
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.signed_at) return res.status(400).json({ error: 'This contract has already been signed.' });
  if (row.deposit_amount && !row.deposit_paid_at) {
    return res.status(400).json({ error: 'Please complete the deposit payment before signing.' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const { rows: [updated] } = await pool.query(
    `UPDATE client_contract_signatures
       SET signed_name = $1, signed_at = now(), ip_address = $2,
           contact_name = COALESCE($3, contact_name), email = $4, phone = COALESCE($5, phone),
           org_name = COALESCE($6, org_name), street = COALESCE($7, street),
           city = COALESCE($8, city), zip = COALESCE($9, zip)
     WHERE id = $10
     RETURNING signed_at, contact_name, phone, street, city, zip`,
    [signed_name.trim(), ip || null, contact_name?.trim() || null, email.trim(), phone?.trim() || null,
     org_name?.trim() || null, street?.trim() || null, city?.trim() || null, zip?.trim() || null, row.id]
  );

  // If this invite was sent from an existing client's profile (client_id was known up
  // front, not matched later), flip their waiver over immediately — same fields
  // POST /signatures/:id/link sets, just without staff having to do that matching
  // step by hand.
  if (row.client_id) {
    const signedDate = new Date(updated.signed_at).toISOString().slice(0, 10);
    await pool.query(
      `UPDATE clients SET
         waiver_signed = 1, waiver_signed_date = $1,
         contact_person_name = COALESCE(contact_person_name, $2),
         contact_person_phone = COALESCE(contact_person_phone, $3),
         contact_person_email = COALESCE(contact_person_email, $4),
         street = COALESCE(street, $5), city = COALESCE(city, $6), zip = COALESCE(zip, $7)
       WHERE id = $8`,
      [signedDate, updated.contact_name, updated.phone, email.trim(), updated.street, updated.city, updated.zip, row.client_id]
    );
  }

  res.json({ ok: true, signed_at: updated.signed_at });
});

// ── Staff — send the signing link, review who's signed ─────────────────────────

router.use(requireAuth);

router.post('/invite/preview', requireStaff, async (req, res) => {
  const { org_name, contact_name, email, phone, payment_terms_text, deposit_amount, client_id } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  const { rows: [contractRow] } = await pool.query(
    "SELECT value FROM app_settings WHERE key = 'client_contract_text'"
  );
  const contractText = contractRow?.value || '';
  if (!contractText) return res.status(400).json({ error: 'No contract text set up yet.' });

  const token = crypto.randomBytes(16).toString('hex');
  // client_id set here (sent from an existing client's profile) means the signature
  // auto-links and flips their waiver to "signed" the moment they sign — see
  // POST /public/:token/sign. Left null for the general "Send Contract to Sign" flow,
  // which still requires the manual match-up in the signatures list.
  const { rows: [row] } = await pool.query(
    `INSERT INTO client_contract_signatures
       (org_name, contact_name, email, phone, token, contract_text, payment_terms_text, deposit_amount, client_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [org_name?.trim() || null, contact_name?.trim() || null, email.trim(), phone?.trim() || null,
     token, contractText, payment_terms_text?.trim() || null, deposit_amount || null, client_id || null]
  );
  const link = `${APP_URL}/sign-org-contract/${token}`;
  const fillName = (contact_name || '').trim() || 'there';

  const { rows: settingsRows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('client_contract_invite_subject','client_contract_invite_body')"
  );
  const m = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const fill = (str) => (str || '').replace(/\{name\}/g, fillName).replace(/\{link\}/g, link);
  const subject = fill(m.client_contract_invite_subject || 'Bring the Gym to Me — Contract & Payment Agreement');
  const body = fill(m.client_contract_invite_body ||
    `Hi {name},\n\nPlease review and sign the contract here:\n\n{link}\n\nLet us know if you have any questions.`);

  res.json({ signature_id: row.id, subject, body });
});

router.post('/invite/:id/send', requireStaff, async (req, res) => {
  const { email, subject, body } = req.body;
  if (!email || !subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Email, subject, and message are required' });
  }
  const { rows: [row] } = await pool.query(
    'SELECT id FROM client_contract_signatures WHERE id = $1', [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  try {
    await sendMail({ to: email, subject: subject.trim(), text: body });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query('UPDATE client_contract_signatures SET sent_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ok: true, sent_to: email });
});

router.get('/signatures', requireStaff, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.org_name, s.contact_name, s.email, s.phone, s.signed_name, s.signed_at, s.sent_at,
            s.deposit_amount, s.deposit_paid_at, s.client_id, c.name AS client_name
       FROM client_contract_signatures s
       LEFT JOIN clients c ON c.id = s.client_id
      ORDER BY s.created_at DESC LIMIT 100`
  );
  res.json(rows);
});

router.post('/signatures/:id/link', requireStaff, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const { rows: [sig] } = await pool.query(
    'SELECT * FROM client_contract_signatures WHERE id = $1', [req.params.id]
  );
  if (!sig) return res.status(404).json({ error: 'Signature not found' });
  if (!sig.signed_at) return res.status(400).json({ error: 'This contract has not been signed yet.' });

  await pool.query('UPDATE client_contract_signatures SET client_id = $1 WHERE id = $2', [client_id, req.params.id]);
  // Fill in blanks only — never clobber an already-populated client record.
  const signedDate = new Date(sig.signed_at).toISOString().slice(0, 10);
  await pool.query(
    `UPDATE clients SET
       waiver_signed = 1, waiver_signed_date = $1,
       contact_person_name = COALESCE(contact_person_name, $2),
       contact_person_phone = COALESCE(contact_person_phone, $3),
       contact_person_email = COALESCE(contact_person_email, $4),
       street = COALESCE(street, $5), city = COALESCE(city, $6), zip = COALESCE(zip, $7)
     WHERE id = $8`,
    [signedDate, sig.contact_name, sig.phone, sig.email, sig.street, sig.city, sig.zip, client_id]
  );
  res.json({ ok: true });
});

module.exports = router;
