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

// Keep the calendar populated with dated occurrences of every active recurring class,
// out to `horizonDate` ('YYYY-MM-DD'). Runs nightly via runDailySync so the horizon
// keeps sliding forward on its own — nobody has to remember to "extend the calendar."
//
// For each schedule, generation always resumes from the day AFTER its latest existing
// class_sessions row (or its start_date / today if it has none yet) — never re-walks
// dates already generated. That means a session someone deliberately deleted (a one-off
// cancellation) stays deleted instead of being silently resurrected on the next run.
async function generateUpcomingSessions(horizonDate) {
  const { rows: schedules } = await pool.query(
    `SELECT * FROM class_schedules WHERE status = 'active' AND weekday IS NOT NULL`
  );

  const today = ymd(new Date());
  let created = 0;

  for (const sch of schedules) {
    // Also look at sessions NOT linked to this schedule (schedule_id IS NULL) for the same
    // client+instructor — the July migration created a batch of sessions before schedule_id
    // linkage existed. Without this, a schedule's "resume from" date ignores that legacy batch
    // entirely and re-generates dates that already have a (duplicate, unlinked) session —
    // found 87 such duplicate pairs on 2026-08-10, silently doubling payroll/revenue totals for
    // every affected date. IS NOT DISTINCT FROM (vs =) so null-instructor schedules match too.
    const { rows: [{ max_date }] } = await pool.query(
      `SELECT MAX(session_date)::text AS max_date FROM class_sessions
        WHERE schedule_id = $1
           OR (schedule_id IS NULL AND client_id = $2 AND instructor_id IS NOT DISTINCT FROM $3)`,
      [sch.id, sch.client_id, sch.instructor_id]
    );
    let from = max_date ? ymd(addDays(new Date(`${max_date}T00:00:00`), 1)) : (sch.start_date || today);
    if (from < today) from = today;

    for (let d = new Date(`${from}T00:00:00`); ymd(d) <= horizonDate; d = addDays(d, 1)) {
      const dateStr = ymd(d);
      if (sch.end_date && dateStr > sch.end_date) break;
      if (d.getDay() !== sch.weekday) continue;

      const { rowCount } = await pool.query(
        `INSERT INTO class_sessions
           (schedule_id, client_id, instructor_id, session_date, start_time,
            charge_amount, instructor_pay, payment_method, style, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled')
         ON CONFLICT (schedule_id, session_date) WHERE schedule_id IS NOT NULL DO NOTHING`,
        [sch.id, sch.client_id, sch.instructor_id, dateStr, sch.start_time,
         sch.charge_amount, sch.instructor_pay, sch.payment_method, sch.style]
      );
      created += rowCount;
    }
  }

  return { horizon: horizonDate, sessions_created: created };
}

// Deduct one class from a client's active package for each calendar class billed as
// "Package" — mirrors what logging a package session by hand does (packages.js
// POST /:id/sessions), just triggered from the calendar instead of a manual click.
// Idempotent: package_sessions.class_session_id is unique, so a rerun just skips
// sessions already linked.
// dryRun: computes what WOULD happen (including the read-only lookups below) without
// writing, so a preview can show it before anyone commits to it.
// details always includes one entry per qualifying session — including ones already
// handled or blocked — so a preview never silently drops a client the way an empty
// "nothing to do" result would.
async function syncPackages(sessions, { dryRun = false } = {}) {
  let deducted = 0;
  const details = [];
  for (const s of sessions) {
    if (!s.payment_method || !/package/i.test(s.payment_method)) continue;

    const { rows: [already] } = await pool.query(
      'SELECT id FROM package_sessions WHERE class_session_id = $1', [s.id]
    );
    if (already) {
      details.push({ client_id: s.client_id, client_name: s.client_name, session_date: s.session_date, status: 'already_deducted' });
      continue;
    }

    const { rows: [pkg] } = await pool.query(
      `SELECT * FROM client_packages WHERE client_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      [s.client_id]
    );
    if (!pkg) {
      // no active package to charge this class against — leave for manual review
      details.push({ client_id: s.client_id, client_name: s.client_name, session_date: s.session_date, status: 'no_active_package' });
      continue;
    }

    if (!dryRun) {
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
    }
    details.push({ client_id: s.client_id, client_name: s.client_name, session_date: s.session_date, status: 'deducted' });
    deducted++;
  }
  return { deducted, details };
}

// Generic placeholder descriptions that don't tell staff anything about the class — never
// worth reusing as a "previous line" match, so they're excluded when inferring a style.
const GENERIC_DESCRIPTIONS = new Set(['class', 'fitness class', 'fitness classes']);

// A session's own `style` is the first choice for its invoice line description, but it's
// often blank (older calendar rows, one-offs entered without a style). Rather than write
// the meaningless "Class" in that case, work out what this client's classes are actually
// called: check line items already on the invoice (including ones just added earlier in
// this same run), then the client's recurring schedule, then their most recent other class.
async function inferDescription(client_id, style, existingLineItems) {
  if (style) return style;

  const fromExisting = existingLineItems
    .map(li => li.description)
    .filter(d => d && !GENERIC_DESCRIPTIONS.has(d.toLowerCase()));
  if (fromExisting.length) {
    const counts = {};
    for (const d of fromExisting) counts[d] = (counts[d] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  const { rows: [sched] } = await pool.query(
    `SELECT style FROM class_schedules WHERE client_id = $1 AND style IS NOT NULL AND style <> ''
      ORDER BY updated_at DESC LIMIT 1`,
    [client_id]
  );
  if (sched?.style) return sched.style;

  const { rows: [sess] } = await pool.query(
    `SELECT style FROM class_sessions WHERE client_id = $1 AND style IS NOT NULL AND style <> ''
      ORDER BY session_date DESC LIMIT 1`,
    [client_id]
  );
  if (sess?.style) return sess.style;

  // Last resort: this client's own past invoices (manual ones included) — someone billed
  // them for something before, and that description is a better guess than "Class".
  const { rows: pastInvoices } = await pool.query(
    `SELECT line_items FROM invoices WHERE client_id = $1 ORDER BY invoice_date DESC LIMIT 5`,
    [client_id]
  );
  const pastDescriptions = pastInvoices
    .flatMap(inv => { try { return JSON.parse(inv.line_items || '[]'); } catch { return []; } })
    .map(li => li.description)
    .filter(d => d && !GENERIC_DESCRIPTIONS.has(d.toLowerCase()));
  if (pastDescriptions.length) {
    const counts = {};
    for (const d of pastDescriptions) counts[d] = (counts[d] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  return 'Class';
}

// Build/extend each client's auto-generated monthly draft invoice with line items for
// their "Invoice"-billed calendar classes. One draft per (client, billing_period=YYYY-MM),
// found via the invoices_auto_period_uniq index. Idempotent: each line item carries the
// session_id it came from, and a rerun skips sessions already on the invoice.
// dryRun: computes what WOULD happen (including which invoice is new vs. extended)
// without writing, so a preview can show it before anyone commits to it.
async function syncInvoices(sessions, { dryRun = false } = {}) {
  const byClientPeriod = new Map();
  for (const s of sessions) {
    if (!s.payment_method || !/invoice/i.test(s.payment_method)) continue;
    const period = s.session_date.slice(0, 7);
    const key = `${s.client_id}::${period}`;
    if (!byClientPeriod.has(key)) byClientPeriod.set(key, { client_id: s.client_id, client_name: s.client_name, period, sessions: [] });
    byClientPeriod.get(key).sessions.push(s);
  }

  let invoicesTouched = 0;
  let skippedManual = 0;
  const details = [];
  for (const { client_id, client_name, period, sessions: group } of byClientPeriod.values()) {
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
      if (manual) {
        skippedManual++;
        details.push({ client_id, client_name, period, status: 'skipped_manual', classes_added: 0, amount_added: 0, invoice_id: manual.id });
        continue;
      }
    }

    let invoiceId, lineItems;
    if (existing) {
      invoiceId = existing.id;
      lineItems = JSON.parse(existing.line_items || '[]');
    } else if (dryRun) {
      invoiceId = null; // not created yet — this is a preview
      lineItems = [];
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
    let amountAdded = 0;
    let classesAdded = 0;
    const newLines = [];
    for (const s of group) {
      if (already.has(s.id)) continue;
      const line = {
        description: await inferDescription(client_id, s.style, lineItems),
        class_date: s.session_date,
        unit_price: Number(s.charge_amount) || 0,
        session_id: s.id,
      };
      lineItems.push(line);
      newLines.push(line);
      amountAdded += Number(s.charge_amount) || 0;
      classesAdded++;
      added = true;
    }

    if (!added) {
      // Every session this client had this week is already on the invoice — nothing new,
      // but still worth a row so a preview confirms this client WAS checked rather than
      // silently vanishing from the list.
      details.push({ client_id, client_name, period, status: 'up_to_date', classes_added: 0, amount_added: 0, invoice_id: existing.id });
      continue;
    }

    if (!dryRun) {
      const { subtotal, tax_amount, total } = calcTotals(lineItems, 0);
      await pool.query(
        `UPDATE invoices SET line_items=$1, subtotal=$2, tax_amount=$3, total=$4,
           updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$5`,
        [JSON.stringify(lineItems), subtotal, tax_amount, total, invoiceId]
      );
    }
    details.push({
      client_id, client_name, period,
      status: 'updated',
      new_invoice: !existing,
      classes_added: classesAdded,
      amount_added: Number(amountAdded.toFixed(2)),
      lines: newLines,
      // null on a dry-run preview of a brand-new invoice — it doesn't exist to link to yet.
      invoice_id: dryRun && !existing ? null : invoiceId,
    });
    invoicesTouched++;
  }
  return { invoicesTouched, skippedManual, details };
}

// Core sync over an explicit [startDate, endDate] range (both 'YYYY-MM-DD', inclusive).
// Every step is idempotent, so this is safe to rerun over any range — including one that
// overlaps days already synced — to catch up after a missed run or backfill a gap.
// dryRun: runs every lookup but skips every write, so callers can preview the effect
// (which clients' invoices/packages would change) before committing to it.
// clientId: restricts the whole sync to one client, so a single row from a preview can
// be applied on its own instead of committing the entire week at once.
async function syncDateRange(startDate, endDate, { dryRun = false, clientId = null } = {}) {
  const { rows: sessions } = await pool.query(
    `SELECT s.id, s.client_id, c.name AS client_name, s.session_date::text AS session_date,
            s.payment_method, s.style, s.charge_amount
       FROM class_sessions s JOIN clients c ON c.id = s.client_id
      WHERE s.session_date BETWEEN $1 AND $2
        AND ($3::bigint IS NULL OR s.client_id = $3::bigint)`,
    [startDate, endDate, clientId]
  );

  const { deducted: packagesDeducted, details: packageDetails } = await syncPackages(sessions, { dryRun });
  const { invoicesTouched, skippedManual, details: invoiceDetails } = await syncInvoices(sessions, { dryRun });

  return {
    start: startDate,
    end: endDate,
    dry_run: dryRun,
    sessions_seen: sessions.length,
    packages_deducted: packagesDeducted,
    package_details: packageDetails,
    invoices_touched: invoicesTouched,
    invoice_details: invoiceDetails,
    skipped_already_manually_invoiced: skippedManual,
  };
}

// Runs nightly: syncs the day that just fully completed ("yesterday" relative to `now`).
// Classes get picked up the next morning rather than waiting for the end of the week.
async function runDailySync(now = new Date()) {
  const yesterday = ymd(addDays(now, -1));
  const sync = await syncDateRange(yesterday, yesterday);
  // Always keep 2 years of calendar generated ahead — since this runs nightly, the
  // horizon just keeps sliding forward and effectively never runs out again.
  const horizon = ymd(addDays(now, 730));
  const generation = await generateUpcomingSessions(horizon);
  return { ...sync, calendar_generation: generation };
}

module.exports = { syncDateRange, runDailySync, generateUpcomingSessions };
