const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireStaff, requireOwnerAccess } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');
const { generateUpcomingSessions, defaultHorizon } = require('../lib/dailySync');

// Return DATE columns as plain 'YYYY-MM-DD' strings, not JS Date objects: a Date
// gets JSON-serialized to a UTC timestamp and can shift a calendar day off the
// server's timezone. DATE (oid 1082) is used only by this module's tables.
require('pg').types.setTypeParser(1082, (v) => v);

const { findDrift, reconcile } = require('../lib/scheduleDrift');
const { syncMentions, deleteMentions } = require('../lib/mentions');

const router = express.Router();
router.use(requireAuth);

// ── The signed-in instructor's own classes ─────────────────────────────────────
// Registered before requireAdmin below so instructors (non-admin) can reach this one
// route. Deliberately NOT `SELECT s.*` the way GET /sessions does: s.* includes
// charge_amount — what the client pays — which an instructor must never see. Columns are
// listed one by one so a column added to class_sessions later cannot leak here by default.
// An instructor sees their own instructor_pay, and nothing about anybody else's.
//
// GET /my-sessions?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/my-sessions', async (req, res) => {
  if (req.user?.role !== 'instructor' || !req.user.instructor_id) {
    return res.status(403).json({ error: 'Instructor account required' });
  }
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.session_date, s.start_time, s.duration_minutes, s.style, s.status,
            s.instructor_pay,
            s.participant_count, s.participant_ages,
            c.name AS client_name,
            sch.location, sch.special_instructions,
            -- class_notes only. admin_notes is deliberately absent and must stay that
            -- way: it's the one place staff can write something about a class that the
            -- instructor is not meant to read.
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', n.id, 'text', n.text, 'is_task', n.is_task,
                       'is_done', n.is_done, 'created_at', n.created_at)
                     ORDER BY n.created_at)
                FROM class_notes n
               WHERE n.session_id = s.id OR (s.schedule_id IS NOT NULL AND n.schedule_id = s.schedule_id)
            ), '[]'::json) AS notes
       FROM class_sessions s
       JOIN clients c                ON c.id  = s.client_id
       LEFT JOIN class_schedules sch ON sch.id = s.schedule_id
      WHERE s.instructor_id = $3
        AND s.session_date BETWEEN $1 AND $2
      ORDER BY s.session_date, s.start_time NULLS LAST`,
    [start, end, req.user.instructor_id]
  );
  res.json(rows);
});

// The business's own Venmo handle — safe for any authenticated user, instructor or not,
// since it's the same handle already handed out to clients/instructors directly.
router.get('/my-venmo-target', async (req, res) => {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='business_venmo_handle'");
  res.json({ handle: row?.value || '' });
});

// Everything below is staff/admin only — includes client charge amounts and
// every instructor's pay, and lets schedules/sessions be created, edited, or deleted.
router.use(requireStaff);

// ── helpers ───────────────────────────────────────────────────────────────────

// Accept a weekday as 0–6 (0=Sun … 6=Sat) or null; reject anything else.
function normalizeWeekday(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : undefined; // undefined = invalid
}

// Loose YYYY-MM-DD check; the DB does the real validation.
function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// New calendar entries fall back to the client's own default style/participant
// count/ages when staff don't type them in for this particular class — so the
// instructor confirmation email ({style}/{participants}/{ages}) still has something
// to show without re-entering the same info every time for a client who always runs
// the same kind of class. Explicit values on the class always win.
async function fillClientDefaults(client_id, { style, participant_count, participant_ages }) {
  const needsAny = !style || (participant_count === undefined || participant_count === null || participant_count === '') ||
    !participant_ages;
  if (!client_id || !needsAny) return { style, participant_count, participant_ages };

  const { rows: [c] } = await pool.query(
    'SELECT default_age, default_participants, default_style FROM clients WHERE id = $1', [client_id]
  );
  if (!c) return { style, participant_count, participant_ages };
  return {
    style: style || c.default_style || null,
    participant_count: (participant_count === undefined || participant_count === null || participant_count === '')
      ? c.default_participants : participant_count,
    participant_ages: participant_ages || c.default_age || null,
  };
}

// How this client's classes are normally billed, for one-off dates that aren't attached
// to a recurring class. Their active recurring class wins; otherwise whatever their most
// recent class used. Only ever consulted when the caller left the field blank.
async function usualPaymentMethod(client_id) {
  if (!client_id) return null;
  const { rows: [sch] } = await pool.query(
    `SELECT payment_method FROM class_schedules
      WHERE client_id = $1 AND status = 'active' AND COALESCE(payment_method,'') <> ''
      ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [client_id]
  );
  if (sch?.payment_method) return sch.payment_method;
  const { rows: [ses] } = await pool.query(
    `SELECT payment_method FROM class_sessions
      WHERE client_id = $1 AND COALESCE(payment_method,'') <> ''
      ORDER BY session_date DESC LIMIT 1`,
    [client_id]
  );
  return ses?.payment_method || null;
}

// A class added to an existing recurring series should bill the way that series bills.
// Without this, a class created from the calendar with the payment method left blank
// was never counted against the client's package — syncPackages only acts on sessions
// explicitly marked "Package". Only fills what the caller actually left empty.
async function fillFromSchedule(schedule_id, fields) {
  if (!schedule_id) return fields;
  const { rows: [sch] } = await pool.query(
    'SELECT payment_method, charge_amount, instructor_pay, duration_minutes, style FROM class_schedules WHERE id = $1',
    [schedule_id]
  );
  if (!sch) return fields;
  const blank = v => v === undefined || v === null || v === '';
  return {
    ...fields,
    payment_method:   blank(fields.payment_method)   ? sch.payment_method   : fields.payment_method,
    charge_amount:    blank(fields.charge_amount)    ? sch.charge_amount    : fields.charge_amount,
    instructor_pay:   blank(fields.instructor_pay)   ? sch.instructor_pay   : fields.instructor_pay,
    duration_minutes: blank(fields.duration_minutes) ? sch.duration_minutes : fields.duration_minutes,
    style:            blank(fields.style)            ? sch.style            : fields.style,
  };
}

// A schedule with client + instructor names attached (for list/detail views).
async function getScheduleRow(id) {
  const { rows: [row] } = await pool.query(
    `SELECT cs.*, c.name AS client_name, i.name AS instructor_name,
            COALESCE(a.neighborhood, c.neighborhood) AS neighborhood,
            COALESCE(a.street, c.street) AS street,
            COALESCE(a.city, c.city) AS city,
            COALESCE(a.zip, c.zip) AS zip,
            a.label AS address_label, a.notes AS address_notes,
            COALESCE(c.waiver_signed, 0) = 1     AS client_waiver_signed,
            COALESCE(i.contract_signed, 0) = 1   AS instructor_contract_signed,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_schedules cs
       JOIN clients c      ON c.id = cs.client_id
       LEFT JOIN instructors i ON i.id = cs.instructor_id
       LEFT JOIN client_addresses a ON a.id = cs.address_id
      WHERE cs.id = $1`,
    [id]
  );
  return row || null;
}

// ── Recurring schedules ────────────────────────────────────────────────────────

router.get('/schedules', async (req, res) => {
  const { client_id, status } = req.query;
  const where = [];
  const args  = [];
  if (client_id) { args.push(client_id); where.push(`cs.client_id = $${args.length}`); }
  if (status)    { args.push(status);    where.push(`cs.status = $${args.length}`); }
  const { rows } = await pool.query(
    `SELECT cs.*, c.name AS client_name, i.name AS instructor_name,
            COALESCE(a.neighborhood, c.neighborhood) AS neighborhood,
            COALESCE(a.street, c.street) AS street,
            COALESCE(a.city, c.city) AS city,
            COALESCE(a.zip, c.zip) AS zip,
            a.label AS address_label, a.notes AS address_notes,
            COALESCE(c.waiver_signed, 0) = 1     AS client_waiver_signed,
            COALESCE(i.contract_signed, 0) = 1   AS instructor_contract_signed,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_schedules cs
       JOIN clients c      ON c.id = cs.client_id
       LEFT JOIN instructors i ON i.id = cs.instructor_id
       LEFT JOIN client_addresses a ON a.id = cs.address_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.name, cs.weekday NULLS LAST, cs.start_time NULLS LAST`,
    args
  );
  res.json(rows);
});

router.get('/schedules/:id', async (req, res) => {
  const row = await getScheduleRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Schedule not found' });
  res.json(row);
});

router.post('/schedules', async (req, res) => {
  const {
    client_id, instructor_id, weekday, start_time, duration_minutes, charge_amount, charge_note, instructor_pay,
    payment_method, style, location, special_instructions, status, start_date, end_date,
    participant_count, participant_ages, address_id,
  } = req.body;

  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  if (!start_time) return res.status(400).json({ error: 'start_time required' });
  const wd = normalizeWeekday(weekday);
  if (wd === undefined) return res.status(400).json({ error: 'weekday must be 0–6 (0=Sun) or null' });

  const filled = await fillClientDefaults(client_id, { style, participant_count, participant_ages });

  const { rows: [{ id }] } = await pool.query(
    `INSERT INTO class_schedules
       (client_id, instructor_id, weekday, start_time, duration_minutes, charge_amount, charge_note, instructor_pay,
        payment_method, style, location, special_instructions, status, start_date, end_date,
        participant_count, participant_ages, address_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [client_id, instructor_id || null, wd, start_time || null, duration_minutes || 60, charge_amount ?? null, charge_note || null,
     instructor_pay ?? null, payment_method || null, filled.style || null, location || null,
     special_instructions || null, status || 'active', start_date || null, end_date || null,
     filled.participant_count === '' ? null : filled.participant_count ?? null, filled.participant_ages || null,
     address_id || null]
  );
  // Fill the calendar for this schedule right away — otherwise it wouldn't show up
  // until the nightly cron runs, which can be up to 24h away.
  await generateUpcomingSessions(defaultHorizon(), { scheduleId: id });
  res.status(201).json(await getScheduleRow(id));
});

router.put('/schedules/:id', async (req, res) => {
  const existing = await getScheduleRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  const {
    client_id, instructor_id, weekday, start_time, duration_minutes, charge_amount, charge_note, instructor_pay,
    payment_method, style, location, special_instructions, status, start_date, end_date,
    participant_count, participant_ages, address_id,
  } = req.body;
  const wd = normalizeWeekday(weekday);
  if (wd === undefined) return res.status(400).json({ error: 'weekday must be 0–6 (0=Sun) or null' });

  // Switching who's teaching invalidates any confirmation already sent to the old
  // instructor — clear it so the UI goes back to "needs confirmation" for the new one.
  const newInstructorId = instructor_id || null;
  const instructorChanged = existing.confirmation_sent_at && newInstructorId !== existing.instructor_id;

  await pool.query(
    `UPDATE class_schedules SET
       client_id=$1, instructor_id=$2, weekday=$3, start_time=$4, duration_minutes=$5, charge_amount=$6, charge_note=$7,
       instructor_pay=$8, payment_method=$9, style=$10, location=$11, special_instructions=$12,
       status=$13, start_date=$14, end_date=$15, participant_count=$16, participant_ages=$17,
       address_id=$19,
       ${instructorChanged ? 'confirmation_sent_at=NULL, confirmation_sent_to=NULL,' : ''}
       updated_at=now()
     WHERE id=$18`,
    [client_id ?? existing.client_id, newInstructorId, wd, start_time || null, duration_minutes || 60,
     charge_amount ?? null, charge_note || null, instructor_pay ?? null, payment_method || null, style || null,
     location || null, special_instructions || null, status || 'active',
     start_date || null, end_date || null,
     participant_count === '' ? null : participant_count ?? null, participant_ages || null,
     req.params.id, address_id || null]
  );
  // Editing the recurring class has to reach the classes already sitting on the
  // calendar, or the change silently applies to nothing you can see: generateUpcoming-
  // Sessions only ever INSERTs missing dates (ON CONFLICT DO NOTHING), so every
  // already-generated future session kept the old time. Reported by Maria on
  // 2026-08-31 — she changed the time on a recurring class and the future classes
  // stayed put.
  //
  // Only fields that actually changed in this edit are pushed down, so a deliberate
  // one-off on a single date (a substitute instructor, a different rate for one week)
  // survives an unrelated edit to the series. Past classes are never touched — billing
  // and payroll history stay as they actually happened — and neither are cancelled ones.
  const PROPAGATED = [
    'instructor_id', 'start_time', 'duration_minutes', 'charge_amount', 'charge_note',
    'instructor_pay', 'payment_method', 'style', 'participant_count', 'participant_ages',
    // Moving the class to the client's other address moves the dates with it.
    'address_id',
  ];
  const after = await getScheduleRow(req.params.id);
  const changed = PROPAGATED.filter(f => String(existing[f] ?? '') !== String(after[f] ?? ''));

  let sessionsUpdated = 0;
  if (changed.length) {
    const sets = changed.map((f, i) => `${f}=$${i + 1}`);
    const args = changed.map(f => after[f] ?? null);
    // A new instructor invalidates any confirmation already sent to the old one.
    if (changed.includes('instructor_id')) {
      sets.push('confirmation_sent_at=NULL', 'confirmation_sent_to=NULL');
    }
    sets.push('updated_at=now()');
    args.push(req.params.id);
    const { rowCount } = await pool.query(
      `UPDATE class_sessions SET ${sets.join(', ')}
        WHERE schedule_id=$${args.length}
          AND session_date >= CURRENT_DATE
          AND status <> 'cancelled'`,
      args
    );
    sessionsUpdated = rowCount;
  }

  // A moved weekday is the one change that can't be patched in place — the existing
  // future classes are on the wrong day entirely. Clear them and let the generator lay
  // the series down again on the new day.
  const weekdayMoved = String(existing.weekday ?? '') !== String(after.weekday ?? '');
  if (weekdayMoved) {
    await pool.query(
      `DELETE FROM class_sessions
        WHERE schedule_id=$1 AND session_date >= CURRENT_DATE AND status <> 'cancelled'`,
      [req.params.id]
    );
  }

  // Same reasoning as POST /schedules — pick up a new weekday/reactivation/date change
  // immediately instead of waiting for the nightly cron.
  await generateUpcomingSessions(defaultHorizon(), { scheduleId: Number(req.params.id) });
  res.json({
    ...(await getScheduleRow(req.params.id)),
    sessions_updated: sessionsUpdated,
    sessions_regenerated: weekdayMoved,
  });
});

router.delete('/schedules/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  await pool.query('DELETE FROM class_schedules WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Permanently removes every not-yet-happened session for this schedule (keeps the
// recurring schedule itself, and keeps past sessions so billing/payroll history stays intact).
// ── Calendar vs recurring classes ─────────────────────────────────────────────
// Where the two disagree, and a way to make the calendar match. See
// server/lib/scheduleDrift.js for why this exists rather than an automatic sync.
router.get('/drift', async (req, res) => {
  res.json(await findDrift());
});

router.post('/drift/:scheduleId/reconcile', async (req, res) => {
  const { fields = [], fix_weekday = false, dry_run = true } = req.body || {};
  const out = await reconcile(req.params.scheduleId, {
    fields, fixWeekday: !!fix_weekday, dryRun: dry_run !== false,
  });
  if (out.error) return res.status(404).json(out);
  res.json(out);
});

router.delete('/schedules/:id/future-sessions', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  const { rowCount } = await pool.query(
    `DELETE FROM class_sessions WHERE schedule_id=$1 AND session_date >= CURRENT_DATE`,
    [req.params.id]
  );
  res.json({ success: true, deleted: rowCount });
});

// ── Dated sessions (the weekly report Amber reads) ─────────────────────────────

// GET /sessions?start=YYYY-MM-DD&end=YYYY-MM-DD  — the week's classes, with names.
router.get('/sessions', async (req, res) => {
  const { start, end, client_id, instructor_id } = req.query;
  if (!isDate(start) || !isDate(end)) {
    return res.status(400).json({ error: 'start and end (YYYY-MM-DD) are required' });
  }
  const args  = [start, end];
  const where = ['s.session_date BETWEEN $1 AND $2'];
  if (client_id)     { args.push(client_id);     where.push(`s.client_id = $${args.length}`); }
  if (instructor_id) { args.push(instructor_id); where.push(`s.instructor_id = $${args.length}`); }

  const { rows } = await pool.query(
    `SELECT s.*, c.name AS client_name, i.name AS instructor_name,
            COALESCE(a.neighborhood, c.neighborhood) AS neighborhood,
            COALESCE(a.street, c.street) AS street,
            COALESCE(a.city, c.city) AS city,
            COALESCE(a.zip, c.zip) AS zip,
            a.label AS address_label, a.notes AS address_notes,
            -- Paperwork state, so the calendar can flag a class whose client has no
            -- waiver on file or whose instructor hasn't signed their contract.
            COALESCE(c.waiver_signed, 0) = 1     AS client_waiver_signed,
            COALESCE(i.contract_signed, 0) = 1   AS instructor_contract_signed,
            (SELECT COUNT(*) FROM class_notes n WHERE n.session_id = s.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.session_id = s.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_sessions s
       JOIN clients c      ON c.id = s.client_id
       LEFT JOIN instructors i ON i.id = s.instructor_id
       LEFT JOIN client_addresses a ON a.id = s.address_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.session_date, s.start_time NULLS LAST, c.name`,
    args
  );
  res.json(rows);
});

router.post('/sessions', async (req, res) => {
  const {
    schedule_id, client_id, instructor_id, session_date, start_time, duration_minutes,
    charge_amount, charge_note, instructor_pay, payment_method, style, status, notes,
    participant_count, participant_ages, address_id,
  } = req.body;
  if (!client_id)          return res.status(400).json({ error: 'client_id required' });
  if (!isDate(session_date)) return res.status(400).json({ error: 'session_date (YYYY-MM-DD) required' });
  if (!start_time)         return res.status(400).json({ error: 'start_time required' });

  const inherited = await fillFromSchedule(schedule_id, {
    payment_method, charge_amount, instructor_pay, duration_minutes, style,
  });
  const filled = await fillClientDefaults(client_id, {
    style: inherited.style, participant_count, participant_ages,
  });

  const { rows: [row] } = await pool.query(
    `INSERT INTO class_sessions
       (schedule_id, client_id, instructor_id, session_date, start_time, duration_minutes,
        charge_amount, charge_note, instructor_pay, payment_method, style, status, notes,
        participant_count, participant_ages, address_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [schedule_id || null, client_id, instructor_id || null, session_date, start_time || null,
     inherited.duration_minutes || 60,
     inherited.charge_amount ?? null, charge_note || null, inherited.instructor_pay ?? null,
     inherited.payment_method || null, filled.style || null,
     status || 'scheduled', notes || null,
     filled.participant_count === '' ? null : filled.participant_count ?? null, filled.participant_ages || null,
     address_id || null]
  );
  res.status(201).json(row);
});

// Ad hoc dated classes — a set of specific dates that don't fit a weekly recurring
// pattern (e.g. "these 6 dates over the next two months"), created in one shot instead
// of one at a time. Same shape as POST /sessions, just `dates` (array) instead of a
// single `session_date`; every date gets its own class_sessions row with schedule_id
// null (not tied to a recurring schedule — deleting one doesn't affect the others).
router.post('/sessions/bulk', async (req, res) => {
  const {
    client_id, instructor_id, dates, start_time, duration_minutes,
    charge_amount, charge_note, instructor_pay, payment_method, style, notes,
    participant_count, participant_ages, address_id,
  } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  if (!start_time) return res.status(400).json({ error: 'start_time required' });
  if (!Array.isArray(dates) || dates.length === 0) return res.status(400).json({ error: 'At least one date is required' });
  if (dates.some(d => !isDate(d))) return res.status(400).json({ error: 'Every date must be YYYY-MM-DD' });

  const filled = await fillClientDefaults(client_id, { style, participant_count, participant_ages });
  // These aren't tied to a recurring class, so there's no schedule to inherit from.
  // Fall back to how this client's other classes are billed — a blank payment method
  // means the class never comes off a package and never lands on an invoice.
  const method = payment_method || await usualPaymentMethod(client_id);

  const created = [];
  for (const session_date of dates) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO class_sessions
         (client_id, instructor_id, session_date, start_time, duration_minutes,
          charge_amount, charge_note, instructor_pay, payment_method, style, status, notes,
          participant_count, participant_ages, address_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled',$11,$12,$13,$14) RETURNING *`,
      [client_id, instructor_id || null, session_date, start_time || null, duration_minutes || 60,
       charge_amount ?? null, charge_note || null, instructor_pay ?? null, method || null, filled.style || null, notes || null,
       filled.participant_count === '' ? null : filled.participant_count ?? null, filled.participant_ages || null,
       address_id || null]
    );
    created.push(row);
  }
  res.status(201).json(created);
});

// Bulk-edit a set of existing sessions at once (e.g. "swap the instructor on every
// upcoming class for this client"). Patch-style like PUT /sessions/:id, but only the
// fields present in the body are touched — across every id in session_ids — and
// session_date/status/notes are deliberately left out since those are per-occurrence,
// not something you'd want to stamp identically across a whole batch.
router.patch('/sessions/bulk-update', async (req, res) => {
  const { session_ids } = req.body;
  if (!Array.isArray(session_ids) || session_ids.length === 0) {
    return res.status(400).json({ error: 'session_ids (non-empty array) required' });
  }
  const fields = ['instructor_id', 'start_time', 'duration_minutes', 'charge_amount', 'instructor_pay', 'payment_method', 'style'];
  const sets = [];
  const args = [];
  for (const key of fields) {
    if (req.body[key] === undefined) continue;
    const val = req.body[key];
    args.push(val === '' ? null : val);
    sets.push(`${key} = $${args.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  // Switching who's teaching invalidates any confirmation already sent — clear it so
  // the UI goes back to "needs confirmation" for whoever's teaching now.
  if ('instructor_id' in req.body) sets.push('confirmation_sent_at = NULL, confirmation_sent_to = NULL');
  sets.push('updated_at = now()');

  args.push(session_ids);
  const { rows } = await pool.query(
    `UPDATE class_sessions SET ${sets.join(', ')} WHERE id = ANY($${args.length}) RETURNING *`,
    args
  );
  res.json(rows);
});

router.put('/sessions/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });

  // Patch-style: only overwrite fields that were sent, keep the rest.
  const m = { ...existing, ...req.body };
  if (req.body.session_date !== undefined && !isDate(m.session_date)) {
    return res.status(400).json({ error: 'session_date must be YYYY-MM-DD' });
  }

  // Switching who's teaching invalidates any confirmation already sent to the old
  // instructor — clear it so the UI goes back to "needs confirmation" for the new one.
  const newInstructorId = m.instructor_id || null;
  const instructorChanged = existing.confirmation_sent_at && newInstructorId !== existing.instructor_id;

  await pool.query(
    `UPDATE class_sessions SET
       instructor_id=$1, session_date=$2, start_time=$3, duration_minutes=$4, charge_amount=$5, charge_note=$6, instructor_pay=$7,
       payment_method=$8, style=$9, status=$10, notes=$11, participant_count=$12, participant_ages=$13,
       address_id=$15,
       ${instructorChanged ? 'confirmation_sent_at=NULL, confirmation_sent_to=NULL,' : ''}
       updated_at=now()
     WHERE id=$14`,
    [newInstructorId, m.session_date, m.start_time || null, m.duration_minutes || 60, m.charge_amount ?? null, m.charge_note || null,
     m.instructor_pay ?? null, m.payment_method || null, m.style || null,
     m.status || 'scheduled', m.notes || null,
     m.participant_count === '' ? null : m.participant_count ?? null, m.participant_ages || null,
     req.params.id, m.address_id ?? null]
  );
  // apply_to_series: the edit was meant for the whole weekly class, not just this date.
  // Updates the recurring schedule (so future generated classes inherit it) and every
  // not-yet-happened class already on the calendar for it. Deliberately excludes
  // session_date — a date only ever means this one occurrence — and leaves past classes
  // alone so billing and payroll history stay as they actually happened.
  let series = null;
  if (req.body.apply_to_series && existing.schedule_id) {
    await pool.query(
      `UPDATE class_schedules SET
         instructor_id=$1, start_time=$2, duration_minutes=$3, charge_amount=$4, charge_note=$5,
         instructor_pay=$6, payment_method=$7, style=$8,
         participant_count=$9, participant_ages=$10, updated_at=now()
       WHERE id=$11`,
      [newInstructorId, m.start_time || null, m.duration_minutes || 60, m.charge_amount ?? null,
       m.charge_note || null, m.instructor_pay ?? null, m.payment_method || null, m.style || null,
       m.participant_count === '' ? null : m.participant_count ?? null, m.participant_ages || null,
       existing.schedule_id]
    );
    const { rowCount } = await pool.query(
      `UPDATE class_sessions SET
         instructor_id=$1, start_time=$2, duration_minutes=$3, charge_amount=$4, charge_note=$5,
         instructor_pay=$6, payment_method=$7, style=$8,
         participant_count=$9, participant_ages=$10,
         ${instructorChanged ? 'confirmation_sent_at=NULL, confirmation_sent_to=NULL,' : ''}
         updated_at=now()
       WHERE schedule_id=$11 AND session_date >= CURRENT_DATE AND status <> 'cancelled'`,
      [newInstructorId, m.start_time || null, m.duration_minutes || 60, m.charge_amount ?? null,
       m.charge_note || null, m.instructor_pay ?? null, m.payment_method || null, m.style || null,
       m.participant_count === '' ? null : m.participant_count ?? null, m.participant_ages || null,
       existing.schedule_id]
    );
    series = { schedule_id: existing.schedule_id, sessions_updated: rowCount };
  }

  const { rows: [row] } = await pool.query('SELECT * FROM class_sessions WHERE id=$1', [req.params.id]);
  res.json({ ...row, series });
});

router.delete('/sessions/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  await pool.query('DELETE FROM class_sessions WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Instructor confirmation email ──────────────────────────────────────────────
// Staff set up a class with an instructor, then send the instructor a confirmation email
// (client, day/time, rate, …) from an editable template. The app fills the template from the
// class so nobody types it by hand; staff review the preview and send. Nothing sends on its own.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Confirmation emails send from office@bgmoffice.com (OFFICE_FROM) — an automated address
// nobody reads. Route replies and a standing copy to Maria instead, so an instructor's
// reply doesn't disappear into an inbox nobody checks.
const CONFIRMATION_CC       = 'maria@bringthegymtome.com';
const CONFIRMATION_REPLY_TO = 'maria@bringthegymtome.com';

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
// "HH:MM" + minutes -> "HH:MM", wrapping past midnight.
function addMinutes(startTime, minutes) {
  const [h, m] = String(startTime).split(':').map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
// "2:00pm–2:45pm" instead of just the start time, so the instructor knows how long the
// class runs without having to know/guess a default.
function fmtTimeRange(startTime, durationMinutes) {
  if (!startTime) return '';
  if (!durationMinutes) return fmtTime(startTime);
  return `${fmtTime(startTime)}–${fmtTime(addMinutes(startTime, durationMinutes))}`;
}
function fmtMoney(v) { return v == null || v === '' ? '' : `$${Number(v).toFixed(0)}`; }

// Street + city + zip, comma/space-joined and skipping whichever parts are blank —
// there's no single "address" column, it's assembled from the client's street/city/zip.
function fmtAddress(row) {
  let addr = [row.street, row.city].filter(Boolean).join(', ');
  if (row.zip) addr = addr ? `${addr} ${row.zip}` : row.zip;
  return addr;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Turns the plain-text confirmation body into an HTML version with its labels bolded
// (Day/Time:, Style of Class:, Rate:, …) — anything at the start of a line that looks
// like "Label:" (letters/digits/spaces then a colon, not the whole line). Staff still
// edit the plain-text template/preview; this is generated fresh at send time so there's
// no separate rich-text template to keep in sync.
function bodyToHtml(text) {
  const escaped = escapeHtml(text)
    .replace(/^([A-Za-z][A-Za-z0-9 /'&-]{0,60}:)/gm, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#1f2937">${escaped}</div>`;
}

async function getTemplate() {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('instructor_confirm_subject','instructor_confirm_body')"
  );
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { subject: m.instructor_confirm_subject || '', body: m.instructor_confirm_body || '' };
}

// Fill {placeholders} in a template string from a context object (see confirmationContext).
function renderTemplate(str, ctx) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, k) => (k in ctx ? ctx[k] : `{${k}}`));
}

// Day name for a plain 'YYYY-MM-DD' string, parsed as a local date (never Date.parse —
// that reads it as UTC midnight and can print the wrong weekday depending on server TZ).
function dayNameFromDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()];
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Aug 25, 2026" for a plain 'YYYY-MM-DD' string — parsed locally, same reasoning as
// dayNameFromDate above.
function fmtCalendarDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The first occurrence of `weekday` (0=Sun…6=Sat) on or after `fromDateStr`
// ('YYYY-MM-DD'). Used to give a recurring schedule a concrete first date when it has
// no explicit start_date on file.
function nextWeekdayOnOrAfter(weekday, fromDateStr) {
  const [y, m, d] = fromDateStr.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  const delta = (weekday - from.getDay() + 7) % 7;
  from.setDate(from.getDate() + delta);
  return toDateStr(from);
}

// Builds the {placeholder} values from either a recurring schedule row or a dated session
// row — same template, same email, whichever the class actually is.
function confirmationContext(row) {
  // A dated session has one concrete date. A recurring schedule doesn't — it's
  // "every Tuesday" indefinitely — so {date} instead spells out when that pattern
  // starts (its start_date if set, else the next upcoming occurrence of its weekday).
  const date = row.session_date
    ? fmtCalendarDate(row.session_date)
    : row.weekday != null
      ? `starting ${fmtCalendarDate(row.start_date || nextWeekdayOnOrAfter(row.weekday, toDateStr(new Date())))}, then weekly`
      : '';
  const day = row.session_date ? dayNameFromDate(row.session_date)
     : (row.weekday != null ? WEEKDAY_NAMES[row.weekday] : 'Flexible');
  const time = fmtTimeRange(row.start_time, row.duration_minutes);
  return {
    instructor_name: row.instructor_name || 'there',
    client_name: row.client_name || '',
    day,
    date,
    time,
    // The single line the template actually prints ("Day/Time: {days_times}") — kept
    // as its own field (rather than baked into the template text) so a combined
    // confirmation (see confirmationContextCombined) can override just this one piece
    // with a multi-day summary without needing a different template.
    days_times: date ? `${day}, ${date} at ${time}` : `${day} at ${time}`,
    neighborhood: row.neighborhood || '',
    address: fmtAddress(row),
    style: row.style || '',
    participants: row.participant_count != null ? String(row.participant_count) : '',
    ages: row.participant_ages || '',
    rate: fmtMoney(row.instructor_pay) ? `${fmtMoney(row.instructor_pay)} per class` : '',
  };
}

// Same shape as confirmationContext, but for several recurring schedules at once — e.g.
// an instructor teaching the same client twice a week. Everything (client, instructor,
// address, style, rate) is taken from the first schedule since a combined email only
// makes sense when those match; only the day/time part is actually combined.
function confirmationContextCombined(rows) {
  const ctx = confirmationContext(rows[0]);
  const parts = rows.map(row => {
    const weekday = row.weekday != null ? `${WEEKDAY_NAMES[row.weekday]}s` : 'Flexible';
    return `${weekday} at ${fmtTimeRange(row.start_time, row.duration_minutes)}`;
  });
  const joined = parts.length <= 1 ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const startDates = rows
    .filter(r => r.weekday != null)
    .map(r => r.start_date || nextWeekdayOnOrAfter(r.weekday, toDateStr(new Date())));
  const earliestStart = startDates.length ? startDates.sort()[0] : null;
  ctx.days_times = earliestStart ? `${joined}, starting ${fmtCalendarDate(earliestStart)}` : joined;
  return ctx;
}

async function getSessionRow(id) {
  const { rows: [row] } = await pool.query(
    `SELECT s.*, c.name AS client_name, i.name AS instructor_name,
            c.neighborhood, c.street, c.city, c.zip
       FROM class_sessions s
       JOIN clients c          ON c.id = s.client_id
       LEFT JOIN instructors i ON i.id = s.instructor_id
      WHERE s.id = $1`,
    [id]
  );
  return row || null;
}

async function buildConfirmation(kind, id) {
  const row = kind === 'session' ? await getSessionRow(id) : await getScheduleRow(id);
  if (!row) return { error: `${kind === 'session' ? 'Session' : 'Schedule'} not found`, status: 404 };
  // A dated session generated from a recurring schedule (schedule_id set) should read
  // as "Every Thursday 10:45–11:45am beginning 10/8/26", same as confirming from the
  // recurring-schedule list — not as its own one-off date. Build the wording off the
  // parent schedule row; the session row still owns its own confirmation_sent_at below.
  let wordingRow = (kind === 'session' && row.schedule_id)
    ? (await getScheduleRow(row.schedule_id)) || row
    : row;
  // A recurring schedule with no explicit start_date on file would otherwise fall back
  // to "next Thursday from today" — misleading once real classes are already on the
  // calendar (e.g. it actually starts after the holidays in October, not this week).
  // The earliest generated class_sessions row is the more trustworthy answer.
  if (wordingRow.weekday != null && !wordingRow.start_date) {
    const { rows: [{ min_date }] } = await pool.query(
      'SELECT MIN(session_date)::text AS min_date FROM class_sessions WHERE schedule_id = $1',
      [wordingRow.id]
    );
    if (min_date) wordingRow = { ...wordingRow, start_date: min_date };
  }
  const { rows: [inst] } = row.instructor_id
    ? await pool.query('SELECT name, email FROM instructors WHERE id=$1', [row.instructor_id])
    : { rows: [] };
  const tpl = await getTemplate();
  const ctx = confirmationContext(wordingRow);
  return {
    to: inst?.email || null,
    instructor_name: inst?.name || null,
    subject: renderTemplate(tpl.subject, ctx),
    body: renderTemplate(tpl.body, ctx),
    already_sent_at: row.confirmation_sent_at || null,
    already_sent_to: row.confirmation_sent_to || null,
  };
}

// Same idea as confirmationContextCombined, but for dated one-off sessions (e.g. a batch
// added via "Add Class Dates") instead of a weekly-recurring schedule — each already has
// its own concrete date, so the combined line is just every date/time listed together
// rather than a "starting X" pattern.
function confirmationContextCombinedSessions(rows) {
  const ctx = confirmationContext(rows[0]);
  const sorted = [...rows].sort((a, b) => a.session_date.localeCompare(b.session_date));
  const parts = sorted.map(row =>
    `${dayNameFromDate(row.session_date)}, ${fmtCalendarDate(row.session_date)} at ${fmtTimeRange(row.start_time, row.duration_minutes)}`
  );
  ctx.days_times = parts.length <= 1 ? parts.join('')
    : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`;
  return ctx;
}

// Other upcoming dated sessions for the same client+instructor as this one — e.g. the
// rest of a batch added together via "Add Class Dates". Confirming any one of them
// should offer to cover all of them in one email instead of sending one per date.
// Sessions generated from a recurring schedule (schedule_id set) are excluded on both
// ends: a recurring occurrence already gets its "Every Thursday…" wording from
// buildConfirmation and shouldn't pull in its own future occurrences as if they were a
// manually-added batch of distinct dates.
async function getSessionSiblings(id) {
  const row = await getSessionRow(id);
  if (!row || !row.instructor_id || row.schedule_id) return [];
  const { rows } = await pool.query(
    `SELECT id FROM class_sessions
      WHERE client_id = $1 AND instructor_id = $2 AND id != $3
        AND session_date >= CURRENT_DATE AND status != 'cancelled' AND schedule_id IS NULL
      ORDER BY session_date`,
    [row.client_id, row.instructor_id, id]
  );
  return rows.map(r => r.id);
}

async function buildCombinedSessionConfirmation(sessionIds) {
  const rows = await Promise.all(sessionIds.map(id => getSessionRow(id)));
  if (rows.some(r => !r)) return { error: 'One or more classes not found', status: 404 };
  const [first] = rows;
  const mismatched = rows.some(r => r.client_id !== first.client_id || r.instructor_id !== first.instructor_id);
  if (mismatched) {
    return { error: 'Combined confirmations only work when every class is for the same client and instructor.', status: 400 };
  }
  const { rows: [inst] } = first.instructor_id
    ? await pool.query('SELECT name, email FROM instructors WHERE id=$1', [first.instructor_id])
    : { rows: [] };
  const tpl = await getTemplate();
  const ctx = confirmationContextCombinedSessions(rows);
  return {
    to: inst?.email || null,
    instructor_name: inst?.name || null,
    subject: renderTemplate(tpl.subject, ctx),
    body: renderTemplate(tpl.body, ctx),
    already_sent_at: rows.every(r => r.confirmation_sent_at) ? rows.map(r => r.confirmation_sent_at).sort().pop() : null,
    already_sent_to: first.confirmation_sent_to || null,
  };
}

router.get('/sessions/:id/siblings', async (req, res) => {
  res.json({ sibling_ids: await getSessionSiblings(req.params.id) });
});

router.post('/sessions/combined-confirmation-preview', async (req, res) => {
  const { session_ids } = req.body;
  if (!Array.isArray(session_ids) || session_ids.length < 2) {
    return res.status(400).json({ error: 'At least two session_ids are required' });
  }
  const r = await buildCombinedSessionConfirmation(session_ids);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/sessions/combined-send-confirmation', async (req, res) => {
  const { session_ids } = req.body;
  if (!Array.isArray(session_ids) || session_ids.length < 2) {
    return res.status(400).json({ error: 'At least two session_ids are required' });
  }
  const r = await buildCombinedSessionConfirmation(session_ids);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file. Add one on their profile first.' });
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body, html: bodyToHtml(body), cc: CONFIRMATION_CC, replyTo: CONFIRMATION_REPLY_TO });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query(
    `UPDATE class_sessions SET confirmation_sent_at=now(), confirmation_sent_to=$1 WHERE id = ANY($2)`,
    [r.to, session_ids]
  );
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
});

async function sendConfirmationRoute(kind, table, req, res) {
  const r = await buildConfirmation(kind, req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file. Add one on their profile first.' });
  // Allow the reviewed/edited preview to be sent verbatim.
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body, html: bodyToHtml(body), cc: CONFIRMATION_CC, replyTo: CONFIRMATION_REPLY_TO });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query(
    `UPDATE ${table} SET confirmation_sent_at=now(), confirmation_sent_to=$1 WHERE id=$2`,
    [r.to, req.params.id]
  );
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
}

router.get('/schedules/:id/confirmation-preview', async (req, res) => {
  const r = await buildConfirmation('schedule', req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/schedules/:id/send-confirmation', (req, res) => sendConfirmationRoute('schedule', 'class_schedules', req, res));

// One confirmation email covering several recurring schedules at once — e.g. an
// instructor teaching the same client twice a week gets one email listing both days
// instead of two separate ones. Only valid when every schedule shares the same client
// and instructor, since a combined email only has room for one address/rate/style.
async function buildCombinedConfirmation(scheduleIds) {
  const rows = await Promise.all(scheduleIds.map(id => getScheduleRow(id)));
  if (rows.some(r => !r)) return { error: 'One or more schedules not found', status: 404 };
  const [first] = rows;
  const mismatched = rows.some(r => r.client_id !== first.client_id || r.instructor_id !== first.instructor_id);
  if (mismatched) {
    return { error: 'Combined confirmations only work when every class is for the same client and instructor.', status: 400 };
  }
  const { rows: [inst] } = first.instructor_id
    ? await pool.query('SELECT name, email FROM instructors WHERE id=$1', [first.instructor_id])
    : { rows: [] };
  const tpl = await getTemplate();
  const ctx = confirmationContextCombined(rows);
  return {
    to: inst?.email || null,
    instructor_name: inst?.name || null,
    subject: renderTemplate(tpl.subject, ctx),
    body: renderTemplate(tpl.body, ctx),
    already_sent_at: rows.every(r => r.confirmation_sent_at) ? rows.map(r => r.confirmation_sent_at).sort().pop() : null,
    already_sent_to: first.confirmation_sent_to || null,
  };
}

router.post('/schedules/combined-confirmation-preview', async (req, res) => {
  const { schedule_ids } = req.body;
  if (!Array.isArray(schedule_ids) || schedule_ids.length < 2) {
    return res.status(400).json({ error: 'At least two schedule_ids are required' });
  }
  const r = await buildCombinedConfirmation(schedule_ids);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/schedules/combined-send-confirmation', async (req, res) => {
  const { schedule_ids } = req.body;
  if (!Array.isArray(schedule_ids) || schedule_ids.length < 2) {
    return res.status(400).json({ error: 'At least two schedule_ids are required' });
  }
  const r = await buildCombinedConfirmation(schedule_ids);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file. Add one on their profile first.' });
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body, html: bodyToHtml(body), cc: CONFIRMATION_CC, replyTo: CONFIRMATION_REPLY_TO });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query(
    `UPDATE class_schedules SET confirmation_sent_at=now(), confirmation_sent_to=$1 WHERE id = ANY($2)`,
    [r.to, schedule_ids]
  );
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
});

router.get('/sessions/:id/confirmation-preview', async (req, res) => {
  const r = await buildConfirmation('session', req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/sessions/:id/send-confirmation', (req, res) => sendConfirmationRoute('session', 'class_sessions', req, res));

// ── "Your class time/date changed" alert ────────────────────────────────────────
// Separate from the initial confirmation — this is a one-off heads-up staff send after
// editing (or drag-and-dropping) a session to a different date/time, so the instructor
// doesn't find out by showing up at the old slot. Reuses confirmationContext for the
// {placeholders}, since the "new" day/time IS whatever the session's current values are.
async function buildRescheduleAlert(id) {
  const row = await getSessionRow(id);
  if (!row) return { error: 'Session not found', status: 404 };
  const { rows: [inst] } = row.instructor_id
    ? await pool.query('SELECT name, email FROM instructors WHERE id=$1', [row.instructor_id])
    : { rows: [] };
  const ctx = confirmationContext(row);
  const subject = `Class time updated — ${ctx.client_name}`;
  const body = `Hi ${ctx.instructor_name},\n\n`
    + `Just a heads up — the date/time for your class with ${ctx.client_name} has changed.\n\n`
    + `New Day/Time: ${ctx.days_times}\n`
    + (ctx.address ? `Location: ${ctx.address}\n` : '')
    + (ctx.style ? `Style of Class: ${ctx.style}\n` : '')
    + (ctx.rate ? `Rate: ${ctx.rate}\n` : '')
    + `\nLet us know if this doesn't work for you.\n\n— BGM Office`;
  return {
    to: inst?.email || null,
    instructor_name: ctx.instructor_name,
    subject, body,
    already_sent_at: row.reschedule_alert_sent_at || null,
    already_sent_to: row.reschedule_alert_sent_to || null,
  };
}

router.get('/sessions/:id/reschedule-alert-preview', async (req, res) => {
  const r = await buildRescheduleAlert(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/sessions/:id/send-reschedule-alert', async (req, res) => {
  const r = await buildRescheduleAlert(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'No email on file for this instructor' });
  const subject = req.body.subject || r.subject;
  const body = req.body.body || r.body;
  await sendMail({ to: r.to, subject, text: body, html: bodyToHtml(body), cc: CONFIRMATION_CC, replyTo: CONFIRMATION_REPLY_TO });
  await pool.query(
    `UPDATE class_sessions SET reschedule_alert_sent_at=now(), reschedule_alert_sent_to=$1 WHERE id=$2`,
    [r.to, req.params.id]
  );
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
});

// ── Notes & tasks on a class ───────────────────────────────────────────────────
// Attached to either a recurring class (schedule) or a dated session. Each row is a
// plain note, or a task (is_task) that can be checked off (is_done). Same shape for
// both parents; the two POST/GET routes below just differ by which id column they set.

async function listClassNotes(col, id) {
  const { rows } = await pool.query(
    `SELECT * FROM class_notes WHERE ${col} = $1 ORDER BY is_done ASC, created_at ASC`, [id]
  );
  return rows;
}

async function addClassNote(col, id, body, initials) {
  const text = (body.text || '').trim();
  if (!text) { const e = new Error('Text required'); e.status = 400; throw e; }
  const { rows: [note] } = await pool.query(
    `INSERT INTO class_notes (${col}, text, is_task, author) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, text, body.is_task ? true : false, initials || null]
  );
  await syncMentions({
    sourceTable: 'class_notes', sourceId: note.id, text,
    authorInitials: initials, linkPath: '/schedule',
  });
  return note;
}

router.get('/schedules/:id/notes', async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  res.json(await listClassNotes('schedule_id', req.params.id));
});

router.post('/schedules/:id/notes', async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  try {
    res.status(201).json(await addClassNote('schedule_id', req.params.id, req.body, req.user.initials));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/sessions/:id/notes', async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(await listClassNotes('session_id', req.params.id));
});

router.post('/sessions/:id/notes', async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  try {
    res.status(201).json(await addClassNote('session_id', req.params.id, req.body, req.user.initials));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Where does this note live? A mention on a class note links to /schedule, but the page
// needs to know which class to open, which week to show, and whether it's a session or a
// recurring schedule before it can put the note on screen. Admin notes answer through
// their own gated route, since who may even know one exists is the point of that table.
async function noteLocation(table, noteId, res) {
  const { rows: [note] } = await pool.query(
    `SELECT schedule_id, session_id FROM ${table} WHERE id = $1`, [noteId]
  );
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.session_id) {
    const { rows: [sess] } = await pool.query(
      'SELECT id, session_date::text AS date FROM class_sessions WHERE id = $1', [note.session_id]
    );
    if (!sess) return res.status(404).json({ error: 'Class not found' });
    return res.json({ kind: 'session', id: sess.id, date: sess.date });
  }
  res.json({ kind: 'schedule', id: note.schedule_id, date: null });
}

router.get('/note-location/class_notes/:noteId', (req, res) =>
  noteLocation('class_notes', req.params.noteId, res));

router.get('/note-location/admin_notes/:noteId', requireOwnerAccess, (req, res) =>
  noteLocation('admin_notes', req.params.noteId, res));

// Edit text / convert note<->task
router.patch('/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM class_notes WHERE id=$1', [req.params.noteId]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const text    = req.body.text    !== undefined ? String(req.body.text).trim() : note.text;
  const is_task = req.body.is_task !== undefined ? !!req.body.is_task            : note.is_task;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const { rows: [updated] } = await pool.query(
    `UPDATE class_notes SET text=$1, is_task=$2, updated_at=now(),
            edited_at = CASE WHEN $1 <> text THEN now() ELSE edited_at END
      WHERE id=$3 RETURNING *`,
    [text, is_task, req.params.noteId]
  );
  await syncMentions({
    sourceTable: 'class_notes', sourceId: updated.id, text,
    authorInitials: req.user.initials, linkPath: '/schedule',
  });
  res.json(updated);
});

// Toggle a task done/undone
router.patch('/notes/:noteId/done', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM class_notes WHERE id=$1', [req.params.noteId]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const nowDone = !note.is_done;
  const { rows: [updated] } = await pool.query(
    'UPDATE class_notes SET is_done=$1, done_at=$2, updated_at=now() WHERE id=$3 RETURNING *',
    [nowDone, nowDone ? new Date().toISOString() : null, req.params.noteId]
  );
  res.json(updated);
});

router.delete('/notes/:noteId', async (req, res) => {
  const result = await pool.query('DELETE FROM class_notes WHERE id=$1', [req.params.noteId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  await deleteMentions('class_notes', req.params.noteId);
  res.json({ success: true });
});

// ── Admin-only notes on a class ─────────────────────────────────────────────────
// Same shape as class_notes above, but a separate table gated by requireOwnerAccess —
// visible only to Sarede/Claire/Maria, not every staff/admin login. Plain notes, no
// task/checkbox (that's what class_notes is for).

async function listAdminNotes(col, id) {
  const { rows } = await pool.query(
    `SELECT * FROM admin_notes WHERE ${col} = $1 ORDER BY created_at ASC`, [id]
  );
  return rows;
}

async function addAdminNote(col, id, body, author) {
  const text = (body.text || '').trim();
  if (!text) { const e = new Error('Text required'); e.status = 400; throw e; }
  const { rows: [note] } = await pool.query(
    `INSERT INTO admin_notes (${col}, text, author) VALUES ($1,$2,$3) RETURNING *`,
    [id, text, author || null]
  );
  await syncMentions({
    sourceTable: 'admin_notes', sourceId: note.id, text,
    authorInitials: author, linkPath: '/schedule',
  });
  return note;
}

router.get('/schedules/:id/admin-notes', requireOwnerAccess, async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  res.json(await listAdminNotes('schedule_id', req.params.id));
});

router.post('/schedules/:id/admin-notes', requireOwnerAccess, async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Schedule not found' });
  try {
    res.status(201).json(await addAdminNote('schedule_id', req.params.id, req.body, req.user.name));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/sessions/:id/admin-notes', requireOwnerAccess, async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(await listAdminNotes('session_id', req.params.id));
});

router.post('/sessions/:id/admin-notes', requireOwnerAccess, async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT id FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  try {
    res.status(201).json(await addAdminNote('session_id', req.params.id, req.body, req.user.name));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

router.patch('/admin-notes/:noteId', requireOwnerAccess, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text required' });
  const { rows: [updated] } = await pool.query(
    'UPDATE admin_notes SET text=$1, updated_at=now(), edited_at=now() WHERE id=$2 RETURNING *',
    [text, req.params.noteId]
  );
  if (!updated) return res.status(404).json({ error: 'Note not found' });
  await syncMentions({
    sourceTable: 'admin_notes', sourceId: updated.id, text,
    authorInitials: req.user.initials, linkPath: '/schedule',
  });
  res.json(updated);
});

router.delete('/admin-notes/:noteId', requireOwnerAccess, async (req, res) => {
  const result = await pool.query('DELETE FROM admin_notes WHERE id=$1', [req.params.noteId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
  await deleteMentions('admin_notes', req.params.noteId);
  res.json({ success: true });
});

module.exports = router;
