const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStripe() {
  const secretKey =
    db.prepare("SELECT value FROM app_settings WHERE key='stripe_secret_key'").get()?.value ||
    process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return require('stripe')(secretKey);
}

function enrichInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    line_items: JSON.parse(row.line_items || '[]'),
  };
}

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const last = db.prepare(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`INV-${year}-%`);
  if (!last) return `INV-${year}-001`;
  const seq = parseInt(last.invoice_number.split('-')[2], 10) + 1;
  return `INV-${year}-${String(seq).padStart(3, '0')}`;
}

function calcTotals(lineItems, taxRate) {
  const subtotal = lineItems.reduce((s, li) => s + Number(li.unit_price || 0), 0);
  const tax_amount = subtotal * (Number(taxRate) / 100);
  const total = subtotal + tax_amount;
  return { subtotal, tax_amount, total };
}

// ── Public routes (no auth) ───────────────────────────────────────────────────

// Get invoice for payment page
router.get('/public/:id', (req, res) => {
  const row = db.prepare(`
    SELECT i.*, cl.name AS client_name, COALESCE(cl.invoice_email, cl.email) AS client_email,
           inst.name AS instructor_name
    FROM invoices i
    LEFT JOIN clients cl     ON cl.id   = i.client_id
    LEFT JOIN instructors inst ON inst.id = i.instructor_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = enrichInvoice(row);
  // Strip sensitive server fields from public view
  delete invoice.stripe_client_secret;
  res.json(invoice);
});

// Create / retrieve payment intent
router.post('/public/:id/pay', async (req, res) => {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  if (row.status === 'paid') return res.status(409).json({ error: 'Already paid' });

  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payment processing is not configured.' });

  try {
    let clientSecret = row.stripe_client_secret;

    // Reuse existing intent if we have one
    if (row.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status)) {
        clientSecret = existing.client_secret;
      }
    }

    if (!clientSecret) {
      // Fetch client email for receipt
      const client = row.client_id
        ? db.prepare('SELECT COALESCE(invoice_email, email) AS email FROM clients WHERE id=?').get(row.client_id)
        : null;

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(row.total * 100), // cents
        currency: 'usd',
        payment_method_types: ['card', 'us_bank_account'],
        receipt_email: client?.email || undefined,
        metadata: { invoice_id: String(row.id), invoice_number: row.invoice_number },
        description: `Invoice ${row.invoice_number}`,
      });

      db.prepare(
        'UPDATE invoices SET stripe_payment_intent_id=?, stripe_client_secret=?, status=? WHERE id=?'
      ).run(intent.id, intent.client_secret, 'sent', row.id);

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

// List invoices
router.get('/', (req, res) => {
  const { status, client_id } = req.query;
  let sql = `
    SELECT i.*, cl.name AS client_name, inst.name AS instructor_name
    FROM invoices i
    LEFT JOIN clients cl       ON cl.id   = i.client_id
    LEFT JOIN instructors inst ON inst.id = i.instructor_id
    WHERE 1=1
  `;
  const params = [];
  if (status)    { sql += ' AND i.status = ?';    params.push(status); }
  if (client_id) { sql += ' AND i.client_id = ?'; params.push(client_id); }
  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(enrichInvoice));
});

// Get single invoice
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT i.*, cl.name AS client_name, COALESCE(cl.invoice_email, cl.email) AS client_email,
           inst.name AS instructor_name
    FROM invoices i
    LEFT JOIN clients cl       ON cl.id   = i.client_id
    LEFT JOIN instructors inst ON inst.id = i.instructor_id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  res.json(enrichInvoice(row));
});

// Create invoice
router.post('/', (req, res) => {
  const { client_id, instructor_id, line_items = [], tax_rate = 0, notes, invoice_date, due_date, title } = req.body;
  const invoice_number = nextInvoiceNumber();
  const { subtotal, tax_amount, total } = calcTotals(line_items, tax_rate);
  const result = db.prepare(`
    INSERT INTO invoices
      (invoice_number, title, client_id, instructor_id, line_items, subtotal, tax_rate, tax_amount, total, notes, invoice_date, due_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invoice_number,
    title || null,
    client_id || null,
    instructor_id || null,
    JSON.stringify(line_items),
    subtotal, tax_rate, tax_amount, total,
    notes || null,
    invoice_date || new Date().toISOString().slice(0, 10),
    due_date || null,
    req.user.initials,
  );
  const row = db.prepare(`
    SELECT i.*, cl.name AS client_name, COALESCE(cl.invoice_email, cl.email) AS client_email, inst.name AS instructor_name
    FROM invoices i
    LEFT JOIN clients cl ON cl.id = i.client_id
    LEFT JOIN instructors inst ON inst.id = i.instructor_id
    WHERE i.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(enrichInvoice(row));
});

// Update invoice
router.put('/:id', (req, res) => {
  const inv = db.prepare('SELECT id, status FROM invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { client_id, instructor_id, line_items = [], tax_rate = 0, notes, invoice_date, due_date, status, title } = req.body;
  const { subtotal, tax_amount, total } = calcTotals(line_items, tax_rate);
  db.prepare(`
    UPDATE invoices SET
      title=?, client_id=?, instructor_id=?, line_items=?, subtotal=?, tax_rate=?, tax_amount=?, total=?,
      notes=?, invoice_date=?, due_date=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    title || null,
    client_id || null, instructor_id || null,
    JSON.stringify(line_items), subtotal, tax_rate, tax_amount, total,
    notes || null, invoice_date || null, due_date || null,
    status || inv.status,
    req.params.id,
  );
  const row = db.prepare(`
    SELECT i.*, cl.name AS client_name, COALESCE(cl.invoice_email, cl.email) AS client_email, inst.name AS instructor_name
    FROM invoices i
    LEFT JOIN clients cl ON cl.id = i.client_id
    LEFT JOIN instructors inst ON inst.id = i.instructor_id
    WHERE i.id = ?
  `).get(req.params.id);
  res.json(enrichInvoice(row));
});

// Update status only
router.patch('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['draft','sent','paid','overdue'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const paid_at = status === 'paid' ? new Date().toISOString() : null;
  db.prepare("UPDATE invoices SET status=?, paid_at=?, updated_at=datetime('now') WHERE id=?")
    .run(status, paid_at, req.params.id);
  const row = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id);
  res.json(enrichInvoice(row));
});

// Delete invoice
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
