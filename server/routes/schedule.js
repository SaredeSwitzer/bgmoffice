const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');

// Return DATE columns as plain 'YYYY-MM-DD' strings, not JS Date objects: a Date
// gets JSON-serialized to a UTC timestamp and can shift a calendar day off the
// server's timezone. DATE (oid 1082) is used only by this module's tables.
require('pg').types.setTypeParser(1082, (v) => v);

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
    `SELECT s.id, s.session_date, s.start_time, s.style, s.status,
            s.instructor_pay,
            c.name AS client_name,
            sch.location, sch.special_instructions
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
router.use(requireAdmin);

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

// A schedule with client + instructor names attached (for list/detail views).
async function getScheduleRow(id) {
  const { rows: [row] } = await pool.query(
    `SELECT cs.*, c.name AS client_name, i.name AS instructor_name,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_schedules cs
       JOIN clients c      ON c.id = cs.client_id
       LEFT JOIN instructors i ON i.id = cs.instructor_id
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
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.schedule_id = cs.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_schedules cs
       JOIN clients c      ON c.id = cs.client_id
       LEFT JOIN instructors i ON i.id = cs.instructor_id
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
    client_id, instructor_id, weekday, start_time, charge_amount, instructor_pay,
    payment_method, style, location, special_instructions, status, start_date, end_date,
  } = req.body;

  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const wd = normalizeWeekday(weekday);
  if (wd === undefined) return res.status(400).json({ error: 'weekday must be 0–6 (0=Sun) or null' });

  const { rows: [{ id }] } = await pool.query(
    `INSERT INTO class_schedules
       (client_id, instructor_id, weekday, start_time, charge_amount, instructor_pay,
        payment_method, style, location, special_instructions, status, start_date, end_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [client_id, instructor_id || null, wd, start_time || null, charge_amount ?? null,
     instructor_pay ?? null, payment_method || null, style || null, location || null,
     special_instructions || null, status || 'active', start_date || null, end_date || null]
  );
  res.status(201).json(await getScheduleRow(id));
});

router.put('/schedules/:id', async (req, res) => {
  const existing = await getScheduleRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  const {
    client_id, instructor_id, weekday, start_time, charge_amount, instructor_pay,
    payment_method, style, location, special_instructions, status, start_date, end_date,
  } = req.body;
  const wd = normalizeWeekday(weekday);
  if (wd === undefined) return res.status(400).json({ error: 'weekday must be 0–6 (0=Sun) or null' });

  await pool.query(
    `UPDATE class_schedules SET
       client_id=$1, instructor_id=$2, weekday=$3, start_time=$4, charge_amount=$5,
       instructor_pay=$6, payment_method=$7, style=$8, location=$9, special_instructions=$10,
       status=$11, start_date=$12, end_date=$13, updated_at=now()
     WHERE id=$14`,
    [client_id ?? existing.client_id, instructor_id || null, wd, start_time || null,
     charge_amount ?? null, instructor_pay ?? null, payment_method || null, style || null,
     location || null, special_instructions || null, status || 'active',
     start_date || null, end_date || null, req.params.id]
  );
  res.json(await getScheduleRow(req.params.id));
});

router.delete('/schedules/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM class_schedules WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  await pool.query('DELETE FROM class_schedules WHERE id=$1', [req.params.id]);
  res.json({ success: true });
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
            (SELECT COUNT(*) FROM class_notes n WHERE n.session_id = s.id)::int AS note_count,
            (SELECT COUNT(*) FROM class_notes n WHERE n.session_id = s.id AND n.is_task AND NOT n.is_done)::int AS open_task_count
       FROM class_sessions s
       JOIN clients c      ON c.id = s.client_id
       LEFT JOIN instructors i ON i.id = s.instructor_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.session_date, s.start_time NULLS LAST, c.name`,
    args
  );
  res.json(rows);
});

router.post('/sessions', async (req, res) => {
  const {
    schedule_id, client_id, instructor_id, session_date, start_time,
    charge_amount, instructor_pay, payment_method, style, status, notes,
  } = req.body;
  if (!client_id)          return res.status(400).json({ error: 'client_id required' });
  if (!isDate(session_date)) return res.status(400).json({ error: 'session_date (YYYY-MM-DD) required' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO class_sessions
       (schedule_id, client_id, instructor_id, session_date, start_time,
        charge_amount, instructor_pay, payment_method, style, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [schedule_id || null, client_id, instructor_id || null, session_date, start_time || null,
     charge_amount ?? null, instructor_pay ?? null, payment_method || null, style || null,
     status || 'scheduled', notes || null]
  );
  res.status(201).json(row);
});

router.put('/sessions/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT * FROM class_sessions WHERE id=$1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Session not found' });

  // Patch-style: only overwrite fields that were sent, keep the rest.
  const m = { ...existing, ...req.body };
  if (req.body.session_date !== undefined && !isDate(m.session_date)) {
    return res.status(400).json({ error: 'session_date must be YYYY-MM-DD' });
  }
  await pool.query(
    `UPDATE class_sessions SET
       instructor_id=$1, session_date=$2, start_time=$3, charge_amount=$4, instructor_pay=$5,
       payment_method=$6, style=$7, status=$8, notes=$9, updated_at=now()
     WHERE id=$10`,
    [m.instructor_id || null, m.session_date, m.start_time || null, m.charge_amount ?? null,
     m.instructor_pay ?? null, m.payment_method || null, m.style || null,
     m.status || 'scheduled', m.notes || null, req.params.id]
  );
  const { rows: [row] } = await pool.query('SELECT * FROM class_sessions WHERE id=$1', [req.params.id]);
  res.json(row);
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

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
function fmtMoney(v) { return v == null || v === '' ? '' : `$${Number(v).toFixed(0)}`; }

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

// Builds the {placeholder} values from either a recurring schedule row or a dated session
// row — same template, same email, whichever the class actually is.
function confirmationContext(row) {
  return {
    instructor_name: row.instructor_name || 'there',
    client_name: row.client_name || '',
    day: row.session_date ? dayNameFromDate(row.session_date)
       : (row.weekday != null ? WEEKDAY_NAMES[row.weekday] : 'Flexible'),
    time: fmtTime(row.start_time),
    location: row.location || '',
    style: row.style || '',
    rate: fmtMoney(row.instructor_pay),
  };
}

async function getSessionRow(id) {
  const { rows: [row] } = await pool.query(
    `SELECT s.*, c.name AS client_name, i.name AS instructor_name, sch.location AS location
       FROM class_sessions s
       JOIN clients c                ON c.id  = s.client_id
       LEFT JOIN instructors i       ON i.id  = s.instructor_id
       LEFT JOIN class_schedules sch ON sch.id = s.schedule_id
      WHERE s.id = $1`,
    [id]
  );
  return row || null;
}

async function buildConfirmation(kind, id) {
  const row = kind === 'session' ? await getSessionRow(id) : await getScheduleRow(id);
  if (!row) return { error: `${kind === 'session' ? 'Session' : 'Schedule'} not found`, status: 404 };
  const { rows: [inst] } = row.instructor_id
    ? await pool.query('SELECT name, email FROM instructors WHERE id=$1', [row.instructor_id])
    : { rows: [] };
  const tpl = await getTemplate();
  const ctx = confirmationContext(row);
  return {
    to: inst?.email || null,
    instructor_name: inst?.name || null,
    subject: renderTemplate(tpl.subject, ctx),
    body: renderTemplate(tpl.body, ctx),
    already_sent_at: row.confirmation_sent_at || null,
    already_sent_to: row.confirmation_sent_to || null,
  };
}

async function sendConfirmationRoute(kind, table, req, res) {
  const r = await buildConfirmation(kind, req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file. Add one on their profile first.' });
  // Allow the reviewed/edited preview to be sent verbatim.
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body });
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

router.get('/sessions/:id/confirmation-preview', async (req, res) => {
  const r = await buildConfirmation('session', req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/sessions/:id/send-confirmation', (req, res) => sendConfirmationRoute('session', 'class_sessions', req, res));

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

// Edit text / convert note<->task
router.patch('/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM class_notes WHERE id=$1', [req.params.noteId]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const text    = req.body.text    !== undefined ? String(req.body.text).trim() : note.text;
  const is_task = req.body.is_task !== undefined ? !!req.body.is_task            : note.is_task;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const { rows: [updated] } = await pool.query(
    'UPDATE class_notes SET text=$1, is_task=$2, updated_at=now() WHERE id=$3 RETURNING *',
    [text, is_task, req.params.noteId]
  );
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
  res.json({ success: true });
});

module.exports = router;
