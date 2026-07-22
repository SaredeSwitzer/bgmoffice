const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { notifyCrew } = require('../lib/notifyCrew');

const router = express.Router();

// ── Stripe helpers ─────────────────────────────────────────────────────────────
async function getStripe() {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  const secretKey = row?.value || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return require('stripe')(secretKey);
}
async function getPublishableKey() {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_publishable_key'");
  return row?.value || process.env.STRIPE_PUBLISHABLE_KEY || null;
}

// Make sure the client has a Stripe customer; returns its id.
async function ensureCustomer(client, stripe) {
  if (client.stripe_customer_id) return client.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: client.name || undefined,
    email: client.invoice_email || client.email || undefined,
    metadata: { client_id: String(client.id) },
  });
  await pool.query('UPDATE clients SET stripe_customer_id=$1 WHERE id=$2', [customer.id, client.id]);
  return customer.id;
}

// After a SetupIntent succeeds, attach its card to the client as the default and
// remember the brand/last4 for display. Shared by the public and in-app save flows.
async function storeCardFromSetupIntent(clientId, setupIntentId, stripe) {
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  if (si.status !== 'succeeded' || !si.payment_method) {
    throw new Error('Card was not saved (setup not complete).');
  }
  const pm = await stripe.paymentMethods.retrieve(si.payment_method);
  const customerId = si.customer;
  // Make it the customer's default so charges "just work".
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  const card = pm.card || {};
  await pool.query(
    `UPDATE clients SET stripe_customer_id=$1, stripe_payment_method_id=$2,
       card_brand=$3, card_last4=$4, card_saved_at=now() WHERE id=$5`,
    [customerId, pm.id, card.brand || null, card.last4 || null, clientId]
  );
  return { card_brand: card.brand || null, card_last4: card.last4 || null };
}

// ── Public "save your card" flow (no auth — backs the /save-card/:token link) ──
// The token is the credential (like invoice public_token). Never expose it elsewhere.

router.get('/save-card/:token', async (req, res) => {
  const { rows: [c] } = await pool.query(
    'SELECT name, card_brand, card_last4 FROM clients WHERE pay_token=$1', [req.params.token]
  );
  if (!c) return res.status(404).json({ error: 'Link not found' });
  res.json({ client_name: c.name, has_card: !!c.card_last4, card_brand: c.card_brand, card_last4: c.card_last4 });
});

router.post('/save-card/:token/intent', async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE pay_token=$1', [req.params.token]);
  if (!client) return res.status(404).json({ error: 'Link not found' });
  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });
  try {
    const customerId = await ensureCustomer(client, stripe);
    const si = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ['card'], usage: 'off_session' });
    res.json({ clientSecret: si.client_secret, publishable_key: await getPublishableKey() });
  } catch (err) {
    console.error('[billing] save-card intent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/save-card/:token/confirm', async (req, res) => {
  const { setup_intent_id } = req.body;
  const { rows: [client] } = await pool.query('SELECT id, name FROM clients WHERE pay_token=$1', [req.params.token]);
  if (!client) return res.status(404).json({ error: 'Link not found' });
  const stripe = await getStripe();
  try {
    const info = await storeCardFromSetupIntent(client.id, setup_intent_id, stripe);
    notifyCrew(`${client.name} just saved a card via their save-card link — ${info.card_brand || 'card'} ending ${info.card_last4 || '????'}.`);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Protected ─────────────────────────────────────────────────────────────────
router.use(requireAuth);

// Lazily mint (or return) the client's save-card token so staff can copy the link.
router.post('/clients/:id/save-link', async (req, res) => {
  const { rows: [c] } = await pool.query('SELECT id, pay_token FROM clients WHERE id=$1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Client not found' });
  let token = c.pay_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    await pool.query('UPDATE clients SET pay_token=$1 WHERE id=$2', [token, c.id]);
  }
  res.json({ token });
});

// Staff keying a card in-app (client on the phone): SetupIntent + confirm.
router.post('/clients/:id/setup-intent', async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });
  const customerId = await ensureCustomer(client, stripe);
  const si = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ['card'], usage: 'off_session' });
  res.json({ clientSecret: si.client_secret, publishable_key: await getPublishableKey() });
});

router.post('/clients/:id/confirm-card', async (req, res) => {
  const stripe = await getStripe();
  try {
    const info = await storeCardFromSetupIntent(req.params.id, req.body.setup_intent_id, stripe);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/clients/:id/card', async (req, res) => {
  await pool.query(
    `UPDATE clients SET stripe_payment_method_id=NULL, card_brand=NULL, card_last4=NULL, card_saved_at=NULL WHERE id=$1`,
    [req.params.id]
  );
  res.json({ ok: true });
});

// ── Weekly review: who has CC classes this week, and how much ─────────────────
// Computed live from class_sessions every time — updating the schedule updates this.
router.get('/week', async (req, res) => {
  const { start } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) {
    return res.status(400).json({ error: 'start (YYYY-MM-DD, the week Sunday) is required' });
  }
  const { rows } = await pool.query(
    `WITH wk AS (
       SELECT s.client_id,
              SUM(s.charge_amount)::numeric(10,2) AS amount,
              COUNT(*) AS session_count
         FROM class_sessions s
        WHERE s.session_date BETWEEN $1::date AND ($1::date + 6)
          AND (s.payment_method ILIKE 'CC' OR s.payment_method ILIKE '%credit%')
          AND s.status <> 'cancelled'
        GROUP BY s.client_id
     )
     SELECT wk.client_id, wk.amount, wk.session_count,
            c.name AS client_name, c.card_brand, c.card_last4,
            (c.card_last4 IS NOT NULL) AS has_card,
            rc.status AS charged_status, rc.amount AS charged_amount
       FROM wk
       JOIN clients c ON c.id = wk.client_id
       LEFT JOIN recurring_charges rc ON rc.client_id = wk.client_id AND rc.week_start = $1::date
      ORDER BY c.name`,
    [start]
  );
  res.json({ week_start: start, items: rows });
});

// ── Charge the approved list off-session ──────────────────────────────────────
router.post('/charge', async (req, res) => {
  const { week_start, items } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) return res.status(400).json({ error: 'week_start required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  const results = [];
  for (const it of items) {
    const { rows: [client] } = await pool.query(
      'SELECT id, name, stripe_customer_id, stripe_payment_method_id, card_last4 FROM clients WHERE id=$1', [it.client_id]
    );
    if (!client) { results.push({ client_id: it.client_id, status: 'failed', error: 'client not found' }); continue; }

    // Never charge twice for the same week.
    const { rows: [already] } = await pool.query(
      'SELECT status FROM recurring_charges WHERE client_id=$1 AND week_start=$2', [client.id, week_start]
    );
    if (already && already.status === 'charged') {
      results.push({ client_id: client.id, client_name: client.name, status: 'skipped', error: 'already charged this week' });
      continue;
    }
    if (!client.stripe_customer_id || !client.stripe_payment_method_id) {
      results.push({ client_id: client.id, client_name: client.name, status: 'failed', error: 'no card on file' });
      continue;
    }
    const amount = Math.round(Number(it.amount) * 100);
    if (!amount || amount < 50) {
      results.push({ client_id: client.id, client_name: client.name, status: 'failed', error: 'invalid amount' });
      continue;
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount, currency: 'usd',
        customer: client.stripe_customer_id,
        payment_method: client.stripe_payment_method_id,
        off_session: true, confirm: true,
        description: `Weekly classes — week of ${week_start}`,
        metadata: { client_id: String(client.id), week_start },
      });
      await pool.query(
        `INSERT INTO recurring_charges (client_id, week_start, amount, session_count, stripe_payment_intent_id, status, charged_by)
         VALUES ($1,$2,$3,$4,$5,'charged',$6)
         ON CONFLICT (client_id, week_start) DO UPDATE SET
           amount=EXCLUDED.amount, stripe_payment_intent_id=EXCLUDED.stripe_payment_intent_id,
           status='charged', error=NULL, created_at=now()`,
        [client.id, week_start, it.amount, it.session_count || null, pi.id, req.user.initials || null]
      );
      results.push({ client_id: client.id, client_name: client.name, status: 'charged', amount: it.amount, last4: client.card_last4 });
    } catch (err) {
      // Card declined / other Stripe error — log it as failed, keep going.
      await pool.query(
        `INSERT INTO recurring_charges (client_id, week_start, amount, session_count, status, error, charged_by)
         VALUES ($1,$2,$3,$4,'failed',$5,$6)
         ON CONFLICT (client_id, week_start) DO UPDATE SET
           amount=EXCLUDED.amount, status='failed', error=EXCLUDED.error, created_at=now()`,
        [client.id, week_start, it.amount, it.session_count || null, err.message, req.user.initials || null]
      );
      results.push({ client_id: client.id, client_name: client.name, status: 'failed', error: err.message });
    }
  }
  res.json({ week_start, results });
});

module.exports = router;
