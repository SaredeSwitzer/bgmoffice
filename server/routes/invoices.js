const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function getStripe() {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  const secretKey = row?.value || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return require('stripe')(secretKey);
}

function enrichInvoice(row) {
  if (!row) return null;
  return { ...row, line_items: JSON.parse(row.line_items || '[]') };
}

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const { rows: [last] } = await pool.query(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY id DESC LIMIT 1",
    [`INV-${year}-%`]
  );
  if (!last) return `INV-${year}-001`;
  const seq = parseInt(last.invoice_number.split('-')[2], 10) + 1;
  return `INV-${year}-${String(seq).padStart(3, '0')}`;
}

function calcTotals(lineItems, taxRate) {
  const subtotal    = lineItems.reduce((s, li) => s + Number(li.unit_price || 0), 0);
  const tax_amount  = subtotal * (Number(taxRate) / 100);
  return { subtotal, tax_amount, total: subtotal + tax_amount };
}

const INVOICE_JOIN = `
  SELECT i.*, cl.name AS client_name,
    COALESCE(cl.invoice_email, cl.email) AS client_email,
    inst.name AS instructor_name
  FROM invoices i
  LEFT JOIN clients cl       ON cl.id   = i.client_id
  LEFT JOIN instructors inst ON inst.id = i.instructor_id
`;

// ── Public routes (no auth) ───────────────────────────────────────────────────
//
// These back the pay-by-link page, so they're open to the world on purpose. They are
// keyed on `public_token` (16 random bytes), NOT on the invoice id. They used to take
// the id — which is a sequential integer — so anyone could walk /public/1, /public/2 …
// and read every invoice, client name and email included, without logging in.
//
// The token IS the credential. Never expose one anywhere but the pay link itself.

router.get('/public/:token', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `${INVOICE_JOIN} WHERE i.public_token = $1`, [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = enrichInvoice(row);
  delete invoice.stripe_client_secret;
  res.json(invoice);
});

router.post('/public/:token/pay', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM invoices WHERE public_token = $1', [req.params.token]
  );
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  if (row.status === 'paid') return res.status(409).json({ error: 'Already paid' });

  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  try {
    let clientSecret = row.stripe_client_secret;

    if (row.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status)) {
        // Re-sync the amount before reusing the intent. Editing an invoice after its pay link
        // was opened used to leave a stale PaymentIntent behind, and we'd hand the client that
        // old intent — charging whatever the invoice USED to say. Found live: INV-2026-007 was
        // a $40 invoice whose intent still wanted $240. Charging a real client 6x the invoice
        // is not a rounding error, it's a lost client.
        const amount = Math.round(row.total * 100);
        if (existing.amount !== amount) {
          const updated = await stripe.paymentIntents.update(existing.id, { amount });
          clientSecret = updated.client_secret;
        } else {
          clientSecret = existing.client_secret;
        }
      }
    }

    if (!clientSecret) {
      let clientEmail = null;
      if (row.client_id) {
        const { rows: [c] } = await pool.query('SELECT COALESCE(invoice_email, email) AS email FROM clients WHERE id=$1', [row.client_id]);
        clientEmail = c?.email || null;
      }

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(row.total * 100),
        currency: 'usd',
        payment_method_types: ['card', 'us_bank_account'],
        receipt_email: clientEmail || undefined,
        metadata: { invoice_id: String(row.id), invoice_number: row.invoice_number },
        description: `Invoice ${row.invoice_number}`,
      });

      await pool.query(
        "UPDATE invoices SET stripe_payment_intent_id=$1, stripe_client_secret=$2, status='sent' WHERE id=$3",
        [intent.id, intent.client_secret, row.id]
      );
      clientSecret = intent.client_secret;
    }

    res.json({ clientSecret });
  } catch (err) {
    console.error('[stripe] paymentIntent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Protected routes ──────────────────────────────────────────────────────────

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { status, client_id } = req.query;
  const conditions = ['1=1'];
  const params = [];
  if (status)    { conditions.push(`i.status = $${params.push(status)}`); }
  if (client_id) { conditions.push(`i.client_id = $${params.push(client_id)}`); }
  const { rows } = await pool.query(`${INVOICE_JOIN} WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC`, params);
  res.json(rows.map(enrichInvoice));
});

router.get('/:id', async (req, res) => {
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  res.json(enrichInvoice(row));
});

router.post('/', async (req, res) => {
  const { client_id, instructor_id, line_items = [], tax_rate = 0, notes, invoice_date, due_date, title } = req.body;
  const invoice_number = await nextInvoiceNumber();
  const { subtotal, tax_amount, total } = calcTotals(line_items, tax_rate);

  const { rows: [inv] } = await pool.query(
    `INSERT INTO invoices
       (invoice_number, title, client_id, instructor_id, line_items, subtotal, tax_rate, tax_amount, total, notes, invoice_date, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [invoice_number, title || null, client_id || null, instructor_id || null, JSON.stringify(line_items), subtotal, tax_rate, tax_amount, total, notes || null, invoice_date || new Date().toISOString().slice(0, 10), due_date || null, req.user.initials]
  );
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [inv.id]);
  res.status(201).json(enrichInvoice(row));
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id, status FROM invoices WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  const { client_id, instructor_id, line_items = [], tax_rate = 0, notes, invoice_date, due_date, status, title } = req.body;
  const { subtotal, tax_amount, total } = calcTotals(line_items, tax_rate);
  await pool.query(
    `UPDATE invoices SET title=$1, client_id=$2, instructor_id=$3, line_items=$4, subtotal=$5, tax_rate=$6,
       tax_amount=$7, total=$8, notes=$9, invoice_date=$10, due_date=$11, status=$12,
       updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS')
     WHERE id=$13`,
    [title || null, client_id || null, instructor_id || null, JSON.stringify(line_items), subtotal, tax_rate, tax_amount, total, notes || null, invoice_date || null, due_date || null, status || existing.status, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.json(enrichInvoice(row));
});

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['draft','sent','paid','overdue'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const paid_at = status === 'paid' ? new Date().toISOString() : null;
  await pool.query(
    "UPDATE invoices SET status=$1, paid_at=$2, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$3",
    [status, paid_at, req.params.id]
  );
  const { rows: [row] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
  res.json(enrichInvoice(row));
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
