const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireSaredeOnly } = require('../middleware/auth');

const router = express.Router();

// Refunds move real money out and cannot be undone from here — Stripe is the only place
// a refund can be reversed, and only sometimes. So: Sarede alone, the same lock the Sales
// tab uses. Claire and Maria can see a charge; they can't send it back.
router.use(requireAuth, requireSaredeOnly);

// The key lives in app_settings first and the env var second, matching billing/invoices.
async function getStripe() {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  const secretKey = row?.value || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return require('stripe')(secretKey);
}

// Money in cents, never floats — 0.1 + 0.2 is not 0.3, and this is somebody's money.
function toCents(v) { return Math.round(Number(v) * 100); }

// What can still be sent back on this payment: what was taken, less what has already
// been refunded. Guards the case of two refunds racing to give back the same money.
async function refundableFor({ chargeId, invoiceId }) {
  if (chargeId) {
    const { rows: [c] } = await pool.query(
      `SELECT rc.id, rc.client_id, rc.amount, rc.status, rc.stripe_payment_intent_id, cl.name AS client_name
         FROM recurring_charges rc LEFT JOIN clients cl ON cl.id = rc.client_id
        WHERE rc.id = $1`, [chargeId]
    );
    if (!c) return { error: 'That charge no longer exists' };
    if (c.status !== 'charged') return { error: `That charge is "${c.status}" — only a charge that went through can be refunded` };
    if (!c.stripe_payment_intent_id) return { error: 'That charge has no Stripe payment on it — it was recorded by hand, so there is nothing to send back' };
    return { kind: 'charge', row: c, paid: Number(c.amount), intent: c.stripe_payment_intent_id };
  }

  const { rows: [inv] } = await pool.query(
    `SELECT i.id, i.client_id, i.invoice_number, i.total, i.amount_paid, i.paid_at,
            i.stripe_payment_intent_id, cl.name AS client_name
       FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
      WHERE i.id = $1`, [invoiceId]
  );
  if (!inv) return { error: 'That invoice no longer exists' };
  if (!inv.stripe_payment_intent_id || !inv.paid_at) {
    return { error: 'That invoice has not been paid by card — there is nothing to send back' };
  }
  return {
    kind: 'invoice', row: inv,
    paid: Number(inv.amount_paid ?? inv.total),
    intent: inv.stripe_payment_intent_id,
  };
}

async function alreadyRefunded(intent) {
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds
      WHERE stripe_payment_intent_id = $1 AND status = 'succeeded'`, [intent]
  );
  return Number(r.total);
}

// What the confirm step shows before anything is sent. Read-only on purpose: the number
// on screen has to be worked out the same way the refund itself will be.
router.get('/available', async (req, res) => {
  const chargeId  = req.query.charge_id  ? Number(req.query.charge_id)  : null;
  const invoiceId = req.query.invoice_id ? Number(req.query.invoice_id) : null;
  if (!chargeId && !invoiceId) return res.status(400).json({ error: 'charge_id or invoice_id is required' });

  const found = await refundableFor({ chargeId, invoiceId });
  if (found.error) return res.status(400).json({ error: found.error });

  const done = await alreadyRefunded(found.intent);
  res.json({
    kind: found.kind,
    client_name: found.row.client_name,
    label: found.kind === 'charge'
      ? `week of ${found.row.week_start || ''}`.trim()
      : `invoice ${found.row.invoice_number}`,
    paid: found.paid,
    already_refunded: done,
    refundable: Math.max(0, found.paid - done),
  });
});

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, cl.name AS client_name, i.invoice_number
       FROM refunds r
       LEFT JOIN clients  cl ON cl.id = r.client_id
       LEFT JOIN invoices i  ON i.id  = r.invoice_id
      ORDER BY r.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { charge_id = null, invoice_id = null, amount, reason } = req.body || {};
  if (!charge_id && !invoice_id) return res.status(400).json({ error: 'charge_id or invoice_id is required' });

  const found = await refundableFor({ chargeId: charge_id, invoiceId: invoice_id });
  if (found.error) return res.status(400).json({ error: found.error });

  const done = await alreadyRefunded(found.intent);
  const refundable = Math.max(0, found.paid - done);
  // Blank amount means the whole of what's left, which is the common case.
  const want = amount === undefined || amount === null || amount === '' ? refundable : Number(amount);

  if (!Number.isFinite(want) || want <= 0) {
    return res.status(400).json({ error: 'Enter how much to refund' });
  }
  if (toCents(want) > toCents(refundable)) {
    return res.status(400).json({
      error: refundable === 0
        ? 'That payment has already been refunded in full'
        : `Only $${refundable.toFixed(2)} of that payment is left to refund`,
    });
  }

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  // Written down BEFORE Stripe is called, so a refund that goes out but errors on the way
  // back still leaves a trace. A silent send is the one outcome there's no recovering from.
  const { rows: [logged] } = await pool.query(
    `INSERT INTO refunds (recurring_charge_id, invoice_id, client_id, stripe_payment_intent_id,
                          amount, reason, status, refunded_by)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING id`,
    [charge_id || null, invoice_id || null, found.row.client_id || null, found.intent,
     want, reason?.trim() || null, req.user.initials || req.user.email || null]
  );

  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: found.intent,
      amount: toCents(want),
      metadata: {
        bgm_refund_id: String(logged.id),
        bgm_kind: found.kind,
        bgm_client: found.row.client_name || '',
      },
    });
  } catch (err) {
    await pool.query('UPDATE refunds SET status=$1, error=$2 WHERE id=$3', ['failed', err.message, logged.id]);
    console.error('[stripe] refund error:', err.message);
    return res.status(502).json({ error: `Stripe would not take that: ${err.message}` });
  }

  await pool.query(
    'UPDATE refunds SET status=$1, stripe_refund_id=$2 WHERE id=$3',
    [refund.status === 'succeeded' ? 'succeeded' : refund.status, refund.id, logged.id]
  );

  // Keep the thing that was refunded honest about it, so the Billing page and the invoice
  // don't still read as fully paid.
  const nowRefunded = done + want;
  if (found.kind === 'charge') {
    await pool.query(
      `UPDATE recurring_charges SET note = TRIM(BOTH ' ' FROM COALESCE(note,'') || $1) WHERE id = $2`,
      [` [refunded $${nowRefunded.toFixed(2)}]`, charge_id]
    );
  } else {
    await pool.query(
      `UPDATE invoices SET amount_paid = GREATEST(0, COALESCE(amount_paid, total) - $1),
                           status = CASE WHEN $2 >= COALESCE(amount_paid, total) THEN 'refunded' ELSE status END
        WHERE id = $3`,
      [want, nowRefunded, invoice_id]
    );
  }

  res.json({
    success: true,
    refund_id: logged.id,
    stripe_refund_id: refund.id,
    status: refund.status,
    amount: want,
    refundable_left: Math.max(0, found.paid - nowRefunded),
  });
});

module.exports = router;
