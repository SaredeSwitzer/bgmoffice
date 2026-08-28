const express = require('express');
const crypto  = require('crypto');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { nextInvoiceNumber, calcTotals } = require('../lib/invoiceHelpers');
const { syncMentions, deleteMentions, stripMentionsForPublic } = require('../lib/mentions');
const { sendMail } = require('../lib/mailer');
const { buildInvoicePdf } = require('../lib/invoicePdf');

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
  // @mentions are an internal aside to a teammate — strip them before this invoice's
  // notes reach the client-facing pay-by-link page.
  invoice.notes = await stripMentionsForPublic(invoice.notes);
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
  const { status, client_id, archived } = req.query;
  const conditions = [`i.archived = ${archived === '1' ? 1 : 0}`];
  const params = [];
  if (status)    { conditions.push(`i.status = $${params.push(status)}`); }
  if (client_id) { conditions.push(`i.client_id = $${params.push(client_id)}`); }
  const { rows } = await pool.query(`${INVOICE_JOIN} WHERE ${conditions.join(' AND ')} ORDER BY i.created_at DESC`, params);
  res.json(rows.map(enrichInvoice));
});

// Every auto-generated, not-yet-approved draft (built by the daily sync) — the current
// month's are still building up class by class, past months' are done and just waiting on
// a send. Approving an invoice (on the invoice page itself) drops it off this list; nothing
// gets sent on its own.
router.get('/ready-to-send', async (req, res) => {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const { rows } = await pool.query(
    `${INVOICE_JOIN} WHERE i.auto_generated = true AND i.status = 'draft' AND i.approved_at IS NULL
      ORDER BY i.billing_period, cl.name`
  );
  res.json(rows.map(r => ({ ...enrichInvoice(r), is_current_month: r.billing_period === currentPeriod })));
});

// A lightweight "I looked this over and it's correct" checkpoint, separate from actually
// sending — staff can approve as invoices build through the month without committing to
// send yet. Toggles: approving an already-approved invoice un-approves it.
router.patch('/:id/approve', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT approved_at FROM invoices WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  const approving = !existing.approved_at;
  await pool.query(
    'UPDATE invoices SET approved_at=$1, approved_by=$2 WHERE id=$3',
    [approving ? new Date().toISOString() : null, approving ? req.user.initials : null, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.json(enrichInvoice(row));
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
       (invoice_number, title, client_id, instructor_id, line_items, subtotal, tax_rate, tax_amount, total, notes, invoice_date, due_date, created_by, public_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [invoice_number, title || null, client_id || null, instructor_id || null, JSON.stringify(line_items), subtotal, tax_rate, tax_amount, total, notes || null, invoice_date || new Date().toISOString().slice(0, 10), due_date || null, req.user.initials, crypto.randomBytes(16).toString('hex')]
  );
  await syncMentions({
    sourceTable: 'invoice_notes', sourceId: inv.id, text: notes || '',
    authorInitials: req.user.initials, linkPath: `/invoices/${inv.id}`,
  });
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
  await syncMentions({
    sourceTable: 'invoice_notes', sourceId: req.params.id, text: notes || '',
    authorInitials: req.user.initials, linkPath: `/invoices/${req.params.id}`,
  });
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.json(enrichInvoice(row));
});

// ── Partial payments ───────────────────────────────────────────────────────
// Manual record of cash/check/etc payments that don't go through Stripe. Recomputes
// amount_paid and status (partial/paid) from the sum of all logged payments, so it
// stays correct even if a payment is deleted later.

async function recalcPaid(invoiceId) {
  const { rows: [{ sum }] } = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS sum FROM invoice_payments WHERE invoice_id=$1', [invoiceId]
  );
  const { rows: [inv] } = await pool.query('SELECT total, status FROM invoices WHERE id=$1', [invoiceId]);
  let status = inv.status;
  let paid_at = null;
  if (Number(sum) >= Number(inv.total) && Number(inv.total) > 0) {
    status = 'paid';
    paid_at = new Date().toISOString();
  } else if (Number(sum) > 0) {
    status = 'partial';
  } else if (status === 'partial') {
    status = 'sent';
  }
  await pool.query(
    "UPDATE invoices SET amount_paid=$1, status=$2, paid_at=$3, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$4",
    [sum, status, paid_at, invoiceId]
  );
}

router.get('/:id/payments', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY paid_date DESC, id DESC', [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/payments', async (req, res) => {
  const { amount, paid_date, method, note } = req.body;
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
  const { rows: [existing] } = await pool.query('SELECT id FROM invoices WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  await pool.query(
    `INSERT INTO invoice_payments (invoice_id, amount, paid_date, method, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.params.id, Number(amount), paid_date || new Date().toISOString().slice(0, 10), method || null, note || null, req.user.initials]
  );
  await recalcPaid(req.params.id);
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.status(201).json(enrichInvoice(row));
});

router.delete('/:id/payments/:paymentId', async (req, res) => {
  const result = await pool.query(
    'DELETE FROM invoice_payments WHERE id=$1 AND invoice_id=$2', [req.params.paymentId, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Payment not found' });
  await recalcPaid(req.params.id);
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
  // "Send this invoice" reminder is done once it's no longer sitting in draft — clear
  // it whether it left draft via "Mark as Sent" here or the real send-with-PDF flow.
  if (status !== 'draft') await pool.query('DELETE FROM reminders WHERE invoice_id = $1', [req.params.id]);
  const { rows: [row] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
  res.json(enrichInvoice(row));
});

const APP_URL = process.env.PUBLIC_APP_URL || 'https://bgmoffice.com';
const DUE_DATE_LEAD_DAYS = 7;
const INVOICE_CC = 'sarede@bringthegymtome.com';

function fmtMoney(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0); }
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + DUE_DATE_LEAD_DAYS);
  return d.toISOString().slice(0, 10);
}

// Preview before sending — staff can edit subject/body/due-date here, same
// preview-then-send pattern used for every other email in the app. due_date isn't
// written yet; that only happens on the actual send, in case staff cancels out.
// Splits a typed recipient list on commas/semicolons/whitespace and keeps what looks
// like an address. Staff type these by hand ("mom@x.com, bookkeeper@y.com"), so the
// separator can't be assumed.
function parseRecipients(input) {
  if (Array.isArray(input)) input = input.join(',');
  return [...new Set(
    String(input || '')
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
  )];
}

router.post('/:id/send-preview', async (req, res) => {
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = enrichInvoice(row);
  if (!invoice.client_email) return res.status(400).json({ error: 'This client has no invoice email on file. Add one first.' });

  // "Due one week from when you send it" only kicks in as a default — an already-set
  // due date (staff picked one deliberately) is left alone.
  const due_date = invoice.due_date || defaultDueDate();
  const payLink = `${APP_URL}/pay/${invoice.public_token}`;
  const subject = `Invoice ${invoice.invoice_number} from BGM Office`;
  const body = `Hi ${invoice.client_name || ''},\n\nPlease find your invoice attached.\n\n`
    + `Invoice: ${invoice.invoice_number}\nAmount Due: ${fmtMoney(invoice.total)}\nDue Date: ${fmtDate(due_date)}\n\n`
    + `Pay online here: ${payLink}\n\nThank you!`;

  // A client's invoice email can hold several addresses ("a@x.com, b@y.com") when their
  // invoices should always go to more than one person — a parent and a bookkeeper, or two
  // contacts at an organisation. Split them into separate recipients rather than one
  // malformed address, which is what `[invoice.client_email]` used to produce.
  res.json({
    to: invoice.client_email,
    recipients: parseRecipients(invoice.client_email),
    subject, body, due_date,
  });
});

// Actually sends it: PDF attached, due date persisted (if it wasn't already set),
// status flipped to sent.
router.post('/:id/send', async (req, res) => {
  const { subject, body, due_date, recipients } = req.body;
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = enrichInvoice(row);

  // One invoice often needs to reach several people — a parent and a bookkeeper, or two
  // contacts at an organisation. Falls back to the client's own address when the caller
  // doesn't specify, so existing behaviour is unchanged.
  const to = recipients !== undefined
    ? parseRecipients(recipients)
    : parseRecipients(invoice.client_email);
  if (to.length === 0) {
    return res.status(400).json({
      error: recipients !== undefined
        ? 'Add at least one valid email address.'
        : 'This client has no invoice email on file. Add one first.',
    });
  }
  if (!subject?.trim() || !body?.trim()) return res.status(400).json({ error: 'Subject and message are required' });

  const finalDueDate = invoice.due_date || due_date || defaultDueDate();
  invoice.notes = await stripMentionsForPublic(invoice.notes);
  invoice.due_date = finalDueDate;

  let pdfBuffer;
  try {
    pdfBuffer = await buildInvoicePdf(invoice);
  } catch (e) {
    console.error('[invoices] PDF build failed:', e.message);
    return res.status(500).json({ error: 'Could not generate the invoice PDF.' });
  }

  try {
    await sendMail({
      to,
      cc: INVOICE_CC,
      subject: subject.trim(),
      text: body,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: pdfBuffer }],
    });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }

  await pool.query(
    "UPDATE invoices SET status='sent', due_date=$1, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$2",
    [finalDueDate, req.params.id]
  );
  await pool.query('DELETE FROM reminders WHERE invoice_id = $1', [req.params.id]);
  const { rows: [updatedRow] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.json(enrichInvoice(updatedRow));
});

router.patch('/:id/archive', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id, archived FROM invoices WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  const newArchived = existing.archived ? 0 : 1;
  await pool.query(
    "UPDATE invoices SET archived=$1, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$2",
    [newArchived, req.params.id]
  );
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [req.params.id]);
  res.json(enrichInvoice(row));
});

// Copies a past invoice into a fresh draft — line items, client, instructor, tax rate and
// notes carry over, but dates reset to today, status resets to draft, and nothing
// payment-related (Stripe intent, amount paid, paid_at) follows along.
router.post('/:id/duplicate', async (req, res) => {
  const { rows: [src] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
  if (!src) return res.status(404).json({ error: 'Invoice not found' });

  const invoice_number = await nextInvoiceNumber();
  const { rows: [inv] } = await pool.query(
    `INSERT INTO invoices
       (invoice_number, title, client_id, instructor_id, line_items, subtotal, tax_rate, tax_amount, total, notes, invoice_date, due_date, created_by, public_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [invoice_number, src.title, src.client_id, src.instructor_id, src.line_items, src.subtotal, src.tax_rate, src.tax_amount, src.total, src.notes, new Date().toISOString().slice(0, 10), null, req.user.initials, crypto.randomBytes(16).toString('hex')]
  );
  await syncMentions({
    sourceTable: 'invoice_notes', sourceId: inv.id, text: src.notes || '',
    authorInitials: req.user.initials, linkPath: `/invoices/${inv.id}`,
  });
  const { rows: [row] } = await pool.query(`${INVOICE_JOIN} WHERE i.id = $1`, [inv.id]);
  res.status(201).json(enrichInvoice(row));
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM invoices WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  await deleteMentions('invoice_notes', req.params.id);
  res.json({ success: true });
});

module.exports = router;
