const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { ymd } = require('../lib/dates');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { notifyCrew } = require('../lib/notifyCrew');
const { sendChargeReceipt } = require('../lib/mailer');
const { syncDateRange } = require('../lib/dailySync');

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
    // Awaited on purpose — Vercel can kill the function right after the response goes out,
    // which was silently dropping this fire-and-forget call more often than not.
    await notifyCrew(`💳 ${client.name} just saved a card via their save-card link — ${info.card_brand || 'card'} ending ${info.card_last4 || '????'}.`);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Protected (staff/admin only — includes client charge amounts and everyone's pay) ──
router.use(requireAuth);
router.use(requireStaff);

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
    const { rows: [client] } = await pool.query('SELECT name FROM clients WHERE id=$1', [req.params.id]);
    await notifyCrew(`💳 A card was saved in-app for ${client?.name || 'a client'} — ${info.card_brand || 'card'} ending ${info.card_last4 || '????'}.`);
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
          AND (s.payment_method ILIKE '%CC%' OR s.payment_method ILIKE '%credit%')
          AND s.status <> 'cancelled'
        GROUP BY s.client_id
     )
     SELECT wk.client_id, wk.amount, wk.session_count,
            c.name AS client_name, c.card_brand, c.card_last4,
            (c.card_last4 IS NOT NULL) AS has_card,
            rc.status AS charged_status, rc.amount AS charged_amount,
            -- Needed to refund it from the Billing page; a charge can only be sent back
            -- if we can point at the row that took the money.
            rc.id AS charge_id, rc.stripe_payment_intent_id,
            COALESCE((SELECT SUM(rf.amount) FROM refunds rf
                       WHERE rf.recurring_charge_id = rc.id AND rf.status = 'succeeded'), 0) AS refunded_amount
       FROM wk
       JOIN clients c ON c.id = wk.client_id
       LEFT JOIN recurring_charges rc ON rc.client_id = wk.client_id AND rc.week_start = $1::date
      ORDER BY c.name`,
    [start]
  );
  res.json({ week_start: start, items: rows });
});

// ── Weekly revenue / payroll report ────────────────────────────────────────────
// Everything on the calendar for the week — every payment method, not just CC — so
// this is the accounting/payroll view, distinct from /week above (which is only the
// classes about to be charged off-session).
router.get('/report', async (req, res) => {
  const { start } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) {
    return res.status(400).json({ error: 'start (YYYY-MM-DD, the week Sunday) is required' });
  }
  const end = `$1::date + 6`;

  const { rows: [totals] } = await pool.query(
    `SELECT COALESCE(SUM(charge_amount), 0)::numeric(10,2)   AS total_revenue,
            COALESCE(SUM(instructor_pay), 0)::numeric(10,2)  AS total_instructor_pay,
            COUNT(*)::int                                    AS session_count
       FROM class_sessions
      WHERE session_date BETWEEN $1::date AND (${end}) AND status <> 'cancelled'`,
    [start]
  );

  const { rows: byPaymentMethod } = await pool.query(
    `SELECT COALESCE(payment_method, 'Unspecified') AS payment_method,
            COALESCE(SUM(charge_amount), 0)::numeric(10,2) AS amount,
            COUNT(*)::int AS session_count
       FROM class_sessions
      WHERE session_date BETWEEN $1::date AND (${end}) AND status <> 'cancelled'
      GROUP BY payment_method ORDER BY amount DESC`,
    [start]
  );

  const { rows: byClient } = await pool.query(
    `SELECT c.id AS client_id, c.name AS client_name,
            COALESCE(SUM(s.charge_amount), 0)::numeric(10,2) AS amount,
            COUNT(*)::int AS session_count,
            rc.status AS charged_status, rc.note AS charged_note
       FROM class_sessions s JOIN clients c ON c.id = s.client_id
       LEFT JOIN recurring_charges rc ON rc.client_id = c.id AND rc.week_start = $1::date
      WHERE s.session_date BETWEEN $1::date AND (${end}) AND s.status <> 'cancelled'
      GROUP BY c.id, c.name, rc.status, rc.note ORDER BY amount DESC`,
    [start]
  );

  const { rows: byInstructor } = await pool.query(
    `SELECT i.id AS instructor_id, i.name AS instructor_name,
            i.payout_method, i.payout_handle,
            COALESCE(SUM(s.instructor_pay), 0)::numeric(10,2) AS total_pay,
            COUNT(*)::int AS session_count,
            ip.status AS paid_status, ip.note AS paid_note
       FROM class_sessions s JOIN instructors i ON i.id = s.instructor_id
       LEFT JOIN instructor_payments ip ON ip.instructor_id = i.id AND ip.week_start = $1::date
      WHERE s.session_date BETWEEN $1::date AND (${end}) AND s.status <> 'cancelled'
      GROUP BY i.id, i.name, i.payout_method, i.payout_handle, ip.status, ip.note ORDER BY i.name`,
    [start]
  );

  // Every individual class for the week — the raw rows behind all the totals above, for
  // whatever ad-hoc question the summaries don't answer.
  const { rows: sessions } = await pool.query(
    `SELECT s.id, s.session_date::text AS session_date, s.start_time::text AS start_time,
            s.duration_minutes,
            c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
            i.id AS instructor_id, i.name AS instructor_name, i.pay_rate AS instructor_expected_rate, s.style,
            s.charge_amount, s.instructor_pay, s.payment_method, s.status
       FROM class_sessions s
       JOIN clients c            ON c.id = s.client_id
       LEFT JOIN instructors i   ON i.id = s.instructor_id
      WHERE s.session_date BETWEEN $1::date AND (${end})
      ORDER BY s.session_date, s.start_time NULLS LAST, c.name`,
    [start]
  );

  res.json({
    week_start: start,
    total_revenue: totals.total_revenue,
    total_instructor_pay: totals.total_instructor_pay,
    net: (Number(totals.total_revenue) - Number(totals.total_instructor_pay)).toFixed(2),
    session_count: totals.session_count,
    by_payment_method: byPaymentMethod,
    by_client: byClient,
    by_instructor: byInstructor,
    sessions,
  });
});

// ── Manual payment-status marking ───────────────────────────────────────────────
// For clients: a status independent of the Stripe off-session flow above — covers a
// declined card, a client who pays by other means, or "haven't gotten to it yet".
// Upserts on (client_id, week_start) so re-marking the same week just updates it.
router.patch('/client-status', async (req, res) => {
  const { client_id, week_start, status, amount, note } = req.body;
  if (!client_id || !/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) {
    return res.status(400).json({ error: 'client_id and week_start (YYYY-MM-DD) required' });
  }
  if (!['charged', 'declined', 'unpaid', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await pool.query(
    `INSERT INTO recurring_charges (client_id, week_start, amount, status, note, charged_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (client_id, week_start) DO UPDATE SET status=$4, note=$5, charged_by=$6`,
    [client_id, week_start, amount || 0, status, note || null, req.user.initials]
  );
  res.json({ ok: true });
});

// Same idea for instructor pay — has this instructor been paid for this week's classes.
router.patch('/instructor-status', async (req, res) => {
  const { instructor_id, week_start, status, amount, note } = req.body;
  if (!instructor_id || !/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) {
    return res.status(400).json({ error: 'instructor_id and week_start (YYYY-MM-DD) required' });
  }
  if (!['paid', 'unpaid'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  await pool.query(
    `INSERT INTO instructor_payments (instructor_id, week_start, amount, status, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (instructor_id, week_start) DO UPDATE SET status=$4, note=$5, updated_by=$6, updated_at=now()`,
    [instructor_id, week_start, amount || 0, status, note || null, req.user.initials]
  );
  res.json({ ok: true });
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
      'SELECT id, name, stripe_customer_id, stripe_payment_method_id, card_last4, COALESCE(invoice_email, email) AS receipt_email FROM clients WHERE id=$1', [it.client_id]
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
      if (client.receipt_email) {
        // Awaited on purpose — Vercel can kill the function right after the response goes
        // out, which silently drops fire-and-forget sends more often than not.
        try {
          await sendChargeReceipt({
            to: client.receipt_email,
            clientName: client.name,
            amount: it.amount,
            description: `weekly classes — week of ${week_start}`,
          });
        } catch (err) {
          console.error('[billing] receipt email failed:', err.message);
        }
      }
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

// ── Recent Stripe charges (for a "what got charged" report, like the old USAePay one) ──
// Pulls straight from Stripe (not our local tables) so it reflects every charge —
// weekly recurring, one-off invoice payments, in-app keyed cards, all of it.
router.get('/stripe-charges', async (req, res) => {
  const { start, end } = req.query;
  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  let created;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start || '') && /^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
    created = {
      gte: Math.floor(new Date(`${start}T00:00:00`).getTime() / 1000),
      lte: Math.floor(new Date(`${end}T23:59:59`).getTime() / 1000),
    };
  } else {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    created = { gte: Math.floor(Date.now() / 1000) - days * 86400 };
  }

  try {
    const charges = [];
    let startingAfter;
    for (let i = 0; i < 20; i++) { // cap ~2000 charges so a bad date range can't run away
      const page = await stripe.charges.list({ created, limit: 100, starting_after: startingAfter });
      charges.push(...page.data);
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    // Resolve a client name for as many charges as possible. Two of our charge paths
    // don't attach a Stripe customer (invoice pay-link charges are guest checkouts), so
    // customer id alone misses them — fall back through the metadata each path does set.
    const customerIds  = [...new Set(charges.map(c => c.customer).filter(Boolean))];
    const clientIds    = [...new Set(charges.map(c => c.metadata?.client_id).filter(Boolean))];
    const invoiceIds   = [...new Set(charges.map(c => c.metadata?.invoice_id).filter(Boolean))];

    const [byCustomer, byClientId, byInvoiceId] = await Promise.all([
      customerIds.length
        ? pool.query('SELECT stripe_customer_id AS key, id, name FROM clients WHERE stripe_customer_id = ANY($1)', [customerIds])
        : { rows: [] },
      clientIds.length
        ? pool.query('SELECT id::text AS key, id, name FROM clients WHERE id = ANY($1::int[])', [clientIds])
        : { rows: [] },
      invoiceIds.length
        ? pool.query(
            `SELECT i.id::text AS key, c.id, c.name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ANY($1::int[])`,
            [invoiceIds]
          )
        : { rows: [] },
    ]);
    const nameByCustomer = Object.fromEntries(byCustomer.rows.map(r => [r.key, r.name]));
    const nameByClientId = Object.fromEntries(byClientId.rows.map(r => [r.key, r.name]));
    const nameByInvoiceId = Object.fromEntries(byInvoiceId.rows.map(r => [r.key, r.name]));
    const idByCustomer = Object.fromEntries(byCustomer.rows.map(r => [r.key, r.id]));
    const idByClientId = Object.fromEntries(byClientId.rows.map(r => [r.key, r.id]));
    const idByInvoiceId = Object.fromEntries(byInvoiceId.rows.map(r => [r.key, r.id]));

    const items = charges.map(c => ({
      id: c.id,
      created: c.created,
      amount: c.amount / 100,
      currency: c.currency,
      status: c.status, // succeeded | pending | failed
      refunded: c.refunded,
      amount_refunded: c.amount_refunded / 100,
      card_brand: c.payment_method_details?.card?.brand || null,
      card_last4: c.payment_method_details?.card?.last4 || null,
      client_name: nameByClientId[c.metadata?.client_id]
        || nameByInvoiceId[c.metadata?.invoice_id]
        || nameByCustomer[c.customer]
        || c.billing_details?.name
        || null,
      client_id: idByClientId[c.metadata?.client_id]
        || idByInvoiceId[c.metadata?.invoice_id]
        || idByCustomer[c.customer]
        || null,
      description: c.description || null,
      failure_message: c.failure_message || null,
    })).sort((a, b) => b.created - a.created);

    res.json({ items });
  } catch (err) {
    console.error('[billing] stripe-charges error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Manual "sync now" for invoices/packages ────────────────────────────────────
// The nightly cron already does this for "yesterday" (server/routes/cron.js), but
// staff sometimes need it to run right now — e.g. after fixing a rate or backfilling
// a missed day — without waiting for the next cron tick. Safe to run repeatedly:
// syncDateRange is idempotent (dedup'd by class_session_id / line_item.session_id).
// Everything a client has actually been charged/paid in a date range, from both places
// money is recorded: Stripe (the weekly card run and pay-link charges, which are only
// ever written to Stripe) and invoice_payments (checks, cash, Zelle — logged in the app).
// Neither alone answers "was this client charged, and when".
router.get('/payments', async (req, res) => {
  const { start, end } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }

  const { rows: manual } = await pool.query(
    `SELECT p.paid_date::text AS date, p.amount::float AS amount,
            COALESCE(p.method, 'Payment') AS method, c.id AS client_id, c.name AS client_name,
            i.invoice_number, p.note
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN clients  c ON c.id = i.client_id
      WHERE p.paid_date BETWEEN $1 AND $2
      ORDER BY p.paid_date DESC`,
    [start, end]
  );

  // Stripe is best-effort: if it's unreachable or unconfigured the in-app payments still
  // come back, with a flag so the UI can say the card side is missing rather than imply
  // these are all the charges there were.
  let card = [];
  let cardError = null;
  try {
    const stripe = await getStripe();
    if (!stripe) throw new Error('Payment processing is not configured.');
    const created = {
      gte: Math.floor(new Date(`${start}T00:00:00`).getTime() / 1000),
      lte: Math.floor(new Date(`${end}T23:59:59`).getTime() / 1000),
    };
    const charges = [];
    let startingAfter;
    for (let i = 0; i < 20; i++) {
      const page = await stripe.charges.list({ created, limit: 100, starting_after: startingAfter });
      charges.push(...page.data);
      if (!page.has_more) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    const succeeded = charges.filter(c => c.status === 'succeeded' && !c.refunded);
    const customerIds = [...new Set(succeeded.map(c => c.customer).filter(Boolean))];
    const clientIds   = [...new Set(succeeded.map(c => c.metadata?.client_id).filter(Boolean))];
    const [byCustomer, byClientId] = await Promise.all([
      customerIds.length
        ? pool.query('SELECT stripe_customer_id AS key, id, name FROM clients WHERE stripe_customer_id = ANY($1)', [customerIds])
        : { rows: [] },
      clientIds.length
        ? pool.query('SELECT id::text AS key, id, name FROM clients WHERE id = ANY($1::int[])', [clientIds])
        : { rows: [] },
    ]);
    const cust = Object.fromEntries(byCustomer.rows.map(r => [r.key, r]));
    const byId = Object.fromEntries(byClientId.rows.map(r => [r.key, r]));
    card = succeeded.map(c => {
      const match = cust[c.customer] || byId[c.metadata?.client_id];
      return {
        date: ymd(c.created * 1000),
        amount: c.amount / 100,
        method: 'Card',
        client_id: match?.id ?? null,
        client_name: match?.name || c.billing_details?.name || 'Unknown',
        invoice_number: null,
        note: c.description || null,
      };
    });
  } catch (e) {
    cardError = e.message;
  }

  const all = [...card, ...manual].sort((a, b) => b.date.localeCompare(a.date));
  const byClient = {};
  for (const r of all) {
    const key = r.client_name;
    if (!byClient[key]) byClient[key] = { client_id: r.client_id, client_name: key, total: 0, payments: [] };
    byClient[key].total += r.amount;
    byClient[key].payments.push(r);
  }

  res.json({
    start, end,
    total: all.reduce((s, r) => s + r.amount, 0),
    count: all.length,
    card_error: cardError,
    clients: Object.values(byClient).sort((a, b) => b.total - a.total),
  });
});

router.post('/sync-week', async (req, res) => {
  const { week_start, dry_run, client_id } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) {
    return res.status(400).json({ error: 'week_start (YYYY-MM-DD, the week Sunday) is required' });
  }
  const end = new Date(`${week_start}T00:00:00`);
  end.setDate(end.getDate() + 6);
  const week_end = end.toISOString().slice(0, 10);

  try {
    const result = await syncDateRange(week_start, week_end, { dryRun: !!dry_run, clientId: client_id || null });
    res.json(result);
  } catch (err) {
    console.error('[billing] sync-week error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
