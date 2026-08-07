const pool = require('../db/pg');
const { nextInvoiceNumber, calcTotals } = require('./invoiceHelpers');

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Deduct one class from a client's active package for each calendar class billed as
// "Package" — mirrors what logging a package session by hand does (packages.js
// POST /:id/sessions), just triggered from the calendar instead of a manual click.
// Idempotent: package_sessions.class_session_id is unique, so a rerun just skips
// sessions already linked.
async function syncPackages(sessions) {
  let deducted = 0;
  for (const s of sessions) {
    if (!s.payment_method || !/package/i.test(s.payment_method)) continue;

    const { rows: [already] } = await pool.query(
      'SELECT id FROM package_sessions WHERE class_session_id = $1', [s.id]
    );
    if (already) continue;

    const { rows: [pkg] } = await pool.query(
      `SELECT * FROM client_packages WHERE client_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      [s.client_id]
    );
    if (!pkg) continue; // no active package to charge this class against — leave for manual review

    await pool.query(
      `INSERT INTO package_sessions (package_id, session_date, notes, created_by, class_session_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [pkg.id, s.session_date, 'Auto-added from calendar', 'daily-sync', s.id]
    );
    await pool.query(
      `UPDATE client_packages SET
         classes_used = (SELECT COUNT(*) FROM package_sessions WHERE package_id = $1),
         status = CASE WHEN (SELECT COUNT(*) FROM package_sessions WHERE package_id = $1) >= total_classes
                       THEN 'completed' ELSE 'active' END
       WHERE id = $1`,
      [pkg.id]
    );
    deducted++;
  }
  return deducted;
}

// Build/extend each client's auto-generated monthly draft invoice with line items for
// their "Invoice"-billed calendar classes. One draft per (client, billing_period=YYYY-MM),
// found via the invoices_auto_period_uniq index. Idempotent: each line item carries the
// session_id it came from, and a rerun skips sessions already on the invoice.
async function syncInvoices(sessions) {
  const byClientPeriod = new Map();
  for (const s of sessions) {
    if (!s.payment_method || !/invoice/i.test(s.payment_method)) continue;
    const period = s.session_date.slice(0, 7);
    const key = `${s.client_id}::${period}`;
    if (!byClientPeriod.has(key)) byClientPeriod.set(key, { client_id: s.client_id, period, sessions: [] });
    byClientPeriod.get(key).sessions.push(s);
  }

  let invoicesTouched = 0;
  let skippedManual = 0;
  for (const { client_id, period, sessions: group } of byClientPeriod.values()) {
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM invoices WHERE client_id = $1 AND billing_period = $2 AND auto_generated = true`,
      [client_id, period]
    );

    // If staff already billed this client for this month by hand, don't create a second,
    // duplicate invoice — that's real money and a human already handled it. Only skips
    // starting a NEW auto invoice; an existing auto invoice still gets extended normally.
    if (!existing) {
      const { rows: [manual] } = await pool.query(
        `SELECT id FROM invoices WHERE client_id = $1 AND auto_generated = false
           AND to_char(invoice_date::date, 'YYYY-MM') = $2 LIMIT 1`,
        [client_id, period]
      );
      if (manual) { skippedManual++; continue; }
    }

    let invoiceId, lineItems;
    if (existing) {
      invoiceId = existing.id;
      lineItems = JSON.parse(existing.line_items || '[]');
    } else {
      const [year, month] = period.split('-');
      const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
      const invoice_number = await nextInvoiceNumber();
      const { rows: [inv] } = await pool.query(
        `INSERT INTO invoices
           (invoice_number, title, client_id, line_items, subtotal, tax_rate, tax_amount, total,
            invoice_date, created_by, auto_generated, billing_period)
         VALUES ($1,$2,$3,'[]',0,0,0,0,$4,'daily-sync',true,$5) RETURNING id`,
        [invoice_number, `${monthName} ${year}`, client_id, ymd(new Date()), period]
      );
      invoiceId = inv.id;
      lineItems = [];
    }

    const already = new Set(lineItems.filter(li => li.session_id).map(li => li.session_id));
    let added = false;
    for (const s of group) {
      if (already.has(s.id)) continue;
      lineItems.push({
        description: s.style || 'Class',
        class_date: s.session_date,
        unit_price: Number(s.charge_amount) || 0,
        session_id: s.id,
      });
      added = true;
    }
    if (!added) continue;

    const { subtotal, tax_amount, total } = calcTotals(lineItems, 0);
    await pool.query(
      `UPDATE invoices SET line_items=$1, subtotal=$2, tax_amount=$3, total=$4,
         updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$5`,
      [JSON.stringify(lineItems), subtotal, tax_amount, total, invoiceId]
    );
    invoicesTouched++;
  }
  return { invoicesTouched, skippedManual };
}

// Core sync over an explicit [startDate, endDate] range (both 'YYYY-MM-DD', inclusive).
// Every step is idempotent, so this is safe to rerun over any range — including one that
// overlaps days already synced — to catch up after a missed run or backfill a gap.
async function syncDateRange(startDate, endDate) {
  const { rows: sessions } = await pool.query(
    `SELECT id, client_id, session_date::text AS session_date, payment_method, style, charge_amount
       FROM class_sessions WHERE session_date BETWEEN $1 AND $2`,
    [startDate, endDate]
  );

  const packagesDeducted = await syncPackages(sessions);
  const { invoicesTouched, skippedManual } = await syncInvoices(sessions);

  return {
    start: startDate,
    end: endDate,
    sessions_seen: sessions.length,
    packages_deducted: packagesDeducted,
    invoices_touched: invoicesTouched,
    skipped_already_manually_invoiced: skippedManual,
  };
}

// Runs nightly: syncs the day that just fully completed ("yesterday" relative to `now`).
// Classes get picked up the next morning rather than waiting for the end of the week.
async function runDailySync(now = new Date()) {
  const yesterday = ymd(addDays(now, -1));
  return syncDateRange(yesterday, yesterday);
}

module.exports = { syncDateRange, runDailySync };
