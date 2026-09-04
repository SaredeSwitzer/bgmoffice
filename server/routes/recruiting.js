const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');
const { sendMail } = require('../lib/mailer');
const { generateUpcomingSessions, defaultHorizon } = require('../lib/dailySync');
const { recordIntake } = require('../lib/clientIntake');

const router = express.Router();

// Mirrors usualPaymentMethod() in routes/schedule.js — duplicated rather than exported
// across routers for one small lookup, same as propagateStyleRename below.
async function usualPaymentMethodFor(client_id) {
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
router.use(requireAuth);

const DAYS = ['Flexible','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Email a candidate the meeting link before they're an instructor record at all —
// no client_id/instructor_id needed, just a name and email typed in on the spot.
// Two-step like the instructor confirmation email: preview (filled from the
// editable template) then send, so staff can tweak wording before it goes out.
router.post('/meeting-invite/preview', requireStaff, async (req, res) => {
  const { name, time } = req.body;
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('meeting_link','meeting_invite_subject','meeting_invite_body')"
  );
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!m.meeting_link) {
    return res.status(400).json({ error: 'No meeting link set up yet.' });
  }
  const fillName = (name || '').trim() || 'there';
  const fillTime = (time || '').trim() || 'the scheduled time';
  const fill = (str) => (str || '')
    .replace(/\{name\}/g, fillName)
    .replace(/\{time\}/g, fillTime)
    .replace(/\{link\}/g, m.meeting_link);
  res.json({
    subject: fill(m.meeting_invite_subject || 'Let\'s hop on a quick video call'),
    body: fill(m.meeting_invite_body || `Hi {name},\n\nHere's the Zoom link: {link}`),
  });
});

router.post('/meeting-invite', requireStaff, async (req, res) => {
  const { email, subject, body } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Subject and message are required' });
  }
  try {
    await sendMail({ to: email, subject: subject.trim(), text: body });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  res.json({ ok: true, sent_to: email });
});

const ENTRY_JOIN = `
  SELECT re.*,
    i.name  AS instructor_name,
    at.name AS action_type_name, at.color AS action_type_color,
    u.name  AS assigned_to_user_name, u.initials AS assigned_to_user_initials
  FROM recruiting_entries re
  LEFT JOIN instructors  i  ON i.id  = re.instructor_id
  LEFT JOIN action_types at ON at.id = re.action_type_id
  LEFT JOIN users        u  ON u.id  = re.assigned_to_user_id
`;

async function attachNoteActionTypes(notes) {
  if (!notes.length) return notes;
  const ids = notes.map(n => n.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `SELECT rnat.note_id, at.id, at.name, at.color
     FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id
     WHERE rnat.note_id IN (${placeholders})`,
    ids
  );
  const byNote = {};
  rows.forEach(r => {
    if (!byNote[r.note_id]) byNote[r.note_id] = [];
    byNote[r.note_id].push({ id: r.id, name: r.name, color: r.color });
  });
  return notes.map(n => ({ ...n, action_types: byNote[n.id] || [] }));
}

async function getEntry(id) {
  const { rows: [entry] } = await pool.query(`${ENTRY_JOIN} WHERE re.id = $1`, [id]);
  if (!entry) return null;
  const { rows: notes } = await pool.query('SELECT * FROM recruiting_notes WHERE entry_id = $1 ORDER BY created_at ASC', [id]);
  entry.notes = await attachNoteActionTypes(notes);
  return entry;
}

function resolveDayOfWeek(preferredDays, explicitDay) {
  if (Array.isArray(preferredDays) && preferredDays.length > 0) {
    return preferredDays.length === 1 ? preferredDays[0].day : 'Flexible';
  }
  return explicitDay || 'Flexible';
}

router.get('/', async (req, res) => {
  const { q, archived } = req.query;
  const showArchived = archived === '1';
  const archivedCond = showArchived ? 're.archived = 1' : 're.archived = 0';
  let entries;

  if (q) {
    const like = `%${q}%`;
    ({ rows: entries } = await pool.query(
      `${ENTRY_JOIN}
       WHERE (${archivedCond}) AND (
         re.time_slot ILIKE $1 OR re.neighborhood ILIKE $2 OR re.style ILIKE $3
         OR re.participants ILIKE $4 OR re.client_name ILIKE $5 OR re.address ILIKE $6
         OR re.phone ILIKE $7 OR re.instructor_info ILIKE $8 OR re.client_rate ILIKE $9
         OR i.name ILIKE $10
       )
       ORDER BY re.day_of_week, re.created_at`,
      [like, like, like, like, like, like, like, like, like, like]
    ));
  } else {
    ({ rows: entries } = await pool.query(`${ENTRY_JOIN} WHERE ${archivedCond} ORDER BY re.created_at ASC`));
  }

  const { rows: allNotes } = await pool.query('SELECT * FROM recruiting_notes ORDER BY created_at ASC');
  const withTypes = await attachNoteActionTypes(allNotes);
  const notesByEntry = {};
  withTypes.forEach(n => {
    if (!notesByEntry[n.entry_id]) notesByEntry[n.entry_id] = [];
    notesByEntry[n.entry_id].push(n);
  });
  entries.forEach(e => { e.notes = notesByEntry[e.id] || []; });

  const grouped = {};
  DAYS.forEach(d => { grouped[d] = []; });
  entries.forEach(e => { if (grouped[e.day_of_week]) grouped[e.day_of_week].push(e); });
  res.json({ grouped });
});

router.get('/client/:clientId', async (req, res) => {
  const { rows: entries } = await pool.query(`${ENTRY_JOIN} WHERE re.client_id = $1 ORDER BY re.created_at DESC`, [req.params.clientId]);
  for (const e of entries) {
    const { rows: notes } = await pool.query('SELECT * FROM recruiting_notes WHERE entry_id = $1 ORDER BY created_at ASC', [e.id]);
    e.notes = await attachNoteActionTypes(notes);
  }
  res.json(entries);
});

router.get('/instructor/:instructorId', async (req, res) => {
  const { rows: entries } = await pool.query(`${ENTRY_JOIN} WHERE re.instructor_id = $1 ORDER BY re.created_at DESC`, [req.params.instructorId]);
  for (const e of entries) {
    const { rows: notes } = await pool.query('SELECT * FROM recruiting_notes WHERE entry_id = $1 ORDER BY created_at ASC', [e.id]);
    e.notes = await attachNoteActionTypes(notes);
  }
  res.json(entries);
});

// Taking on a new class, answered inside the app instead of in the Google Form. Same
// questions, same writer (server/lib/clientIntake.js), so both routes land identically —
// one recruiting entry, and a client profile created or filled in and linked to it.
//
// Not /intake: that path already belongs to the Google Form webhook (mounted ahead of
// this router), which authenticates with a shared secret rather than a login.
router.post('/intake-form', async (req, res) => {
  const { client_id, create_client, preferred_days, class_type, class_dates, instructor_id, ...answers } = req.body || {};
  if (!client_id && !answers.client_name?.trim()) {
    return res.status(400).json({ error: 'Pick the client or type their name' });
  }
  const out = await recordIntake(answers, {
    clientId: client_id || null,
    createClient: !!create_client,
    preferredDays: Array.isArray(preferred_days) ? preferred_days : null,
    createdBy: req.user.initials,
    instructorId: instructor_id || null,
    classType: class_type || null,
    classDates: class_dates || null,
  });
  res.status(201).json(out);
});

router.post('/entries', async (req, res) => {
  const {
    preferred_days, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates, class_notes, address_id, time_preference, instructor_rate,
  } = req.body;

  const day_of_week = resolveDayOfWeek(preferred_days, req.body.day_of_week);
  if (!DAYS.includes(day_of_week)) return res.status(400).json({ error: 'Valid day_of_week required' });

  const resolvedTime = time_slot ||
    (Array.isArray(preferred_days) && preferred_days.length === 1 ? preferred_days[0].time : null);

  const { rows: [entry] } = await pool.query(
    `INSERT INTO recruiting_entries
       (day_of_week, time_slot, neighborhood, style, participants,
        client_name, client_id, address, phone, waiver_signed,
        instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id, created_by,
        class_type, class_dates, class_notes, preferred_days, address_id,
        time_preference, instructor_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [
      day_of_week, resolvedTime || null, neighborhood || null, style || null, participants || null,
      client_name || null, client_id || null, address || null, phone || null, waiver_signed ? 1 : 0,
      instructor_info || null, instructor_id || null, client_rate || null,
      action_type_id || null, assigned_to_user_id || null, req.user.initials,
      class_type || null, class_dates || null, class_notes || null,
      preferred_days ? JSON.stringify(preferred_days) : null,
      address_id || null,
      time_preference || null, instructor_rate || null,
    ]
  );
  res.status(201).json(await getEntry(entry.id));
});

router.put('/entries/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });

  const {
    preferred_days, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates, class_notes, address_id, time_preference, instructor_rate,
  } = req.body;

  const day_of_week = resolveDayOfWeek(preferred_days, req.body.day_of_week);
  const resolvedTime = time_slot ||
    (Array.isArray(preferred_days) && preferred_days.length === 1 ? preferred_days[0].time : null);

  await pool.query(
    `UPDATE recruiting_entries SET
       day_of_week=$1, time_slot=$2, neighborhood=$3, style=$4, participants=$5,
       client_name=$6, client_id=$7, address=$8, phone=$9, waiver_signed=$10,
       instructor_info=$11, instructor_id=$12, client_rate=$13, action_type_id=$14, assigned_to_user_id=$15,
       class_type=$16, class_dates=$17, class_notes=$18, preferred_days=$19, address_id=$21,
       time_preference=$22, instructor_rate=$23
     WHERE id=$20`,
    [
      day_of_week || null, resolvedTime || null, neighborhood || null, style || null, participants || null,
      client_name || null, client_id || null, address || null, phone || null, waiver_signed ? 1 : 0,
      instructor_info || null, instructor_id || null, client_rate || null,
      action_type_id || null, assigned_to_user_id || null,
      class_type || null, class_dates || null, class_notes || null,
      preferred_days ? JSON.stringify(preferred_days) : null,
      req.params.id,
      address_id || null,
      time_preference || null, instructor_rate || null,
    ]
  );
  res.json(await getEntry(req.params.id));
});

router.delete('/entries/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  await pool.query('DELETE FROM recruiting_entries WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.patch('/entries/:id/archive', async (req, res) => {
  const { rows: [entry] } = await pool.query('SELECT id, archived FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const newArchived = entry.archived ? 0 : 1;
  await pool.query('UPDATE recruiting_entries SET archived = $1 WHERE id = $2', [newArchived, req.params.id]);
  res.json(await getEntry(req.params.id));
});

router.post('/entries/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const { rows: [entry] } = await pool.query('SELECT id FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const { rows: [note] } = await pool.query(
    'INSERT INTO recruiting_notes (entry_id, text, author_initials) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, text.trim(), req.user.initials]
  );

  await syncMentions({
    sourceTable: 'recruiting_notes',
    sourceId: note.id,
    text: text.trim(),
    authorInitials: req.user.initials,
    linkPath: `/recruiting?entry=${req.params.id}`,
  });

  res.status(201).json(note);
});

router.put('/entries/:id/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1 AND entry_id = $2', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

  await pool.query('UPDATE recruiting_notes SET text = $1, edited_at = now() WHERE id = $2', [text.trim(), note.id]);

  await syncMentions({
    sourceTable: 'recruiting_notes',
    sourceId: note.id,
    text: text.trim(),
    authorInitials: note.author_initials,
    linkPath: `/recruiting?entry=${req.params.id}`,
  });

  const { rows: [updated] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1', [note.id]);
  res.json(updated);
});

router.delete('/entries/:id/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1 AND entry_id = $2', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  await deleteMentions('recruiting_notes', note.id);
  await pool.query('DELETE FROM recruiting_notes WHERE id = $1', [req.params.noteId]);
  res.json({ success: true });
});

router.get('/availability', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ia.*, i.name AS instructor_name, i.neighborhood AS instructor_neighborhood,
            i.specialties AS instructor_specialties, i.style AS instructor_style, i.styles_taught AS instructor_styles_taught
     FROM instructor_availability ia
     JOIN instructors i ON i.id = ia.instructor_id
     ORDER BY ia.day_of_week, ia.time_slot, i.name`
  );
  res.json(rows);
});

router.post('/availability', async (req, res) => {
  const { instructor_id, day_of_week, time_slot } = req.body;
  if (!instructor_id || !day_of_week) return res.status(400).json({ error: 'instructor_id and day_of_week required' });
  const { rows: [avail] } = await pool.query(
    'INSERT INTO instructor_availability (instructor_id, day_of_week, time_slot) VALUES ($1,$2,$3) RETURNING id',
    [instructor_id, day_of_week, time_slot || null]
  );
  const { rows: [row] } = await pool.query(
    `SELECT ia.*, i.name AS instructor_name FROM instructor_availability ia JOIN instructors i ON i.id = ia.instructor_id WHERE ia.id = $1`,
    [avail.id]
  );
  res.status(201).json(row);
});

router.put('/availability/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM instructor_availability WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { day_of_week, time_slot } = req.body;
  if (!day_of_week) return res.status(400).json({ error: 'day_of_week required' });
  await pool.query('UPDATE instructor_availability SET day_of_week = $1, time_slot = $2 WHERE id = $3', [day_of_week, time_slot || null, req.params.id]);
  const { rows: [row] } = await pool.query(
    `SELECT ia.*, i.name AS instructor_name, i.neighborhood AS instructor_neighborhood, i.specialties AS instructor_specialties, i.style AS instructor_style
     FROM instructor_availability ia JOIN instructors i ON i.id = ia.instructor_id WHERE ia.id = $1`,
    [req.params.id]
  );
  res.json(row);
});

router.delete('/availability/:id', async (req, res) => {
  await pool.query('DELETE FROM instructor_availability WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ── Recruiting entry → calendar ──────────────────────────────────────────────────────
// Once an entry has an instructor lined up, this turns it into real calendar classes
// without retyping everything into the Schedule screen. Two shapes, same as the Schedule
// page itself: a weekly recurring class, or a set of specific dates.
//
// An entry often has no client record yet (it's a lead — Henchi Gross had client_id null),
// so this can create the client from what's already on the entry rather than making
// someone go build it by hand first.
const WEEKDAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

router.post('/:id/schedule', async (req, res) => {
  const { rows: [entry] } = await pool.query('SELECT * FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Recruiting entry not found' });

  const {
    mode, client_id, create_client, instructor_id, weekday, weekdays, start_time,
    duration_minutes, charge_amount, instructor_pay, payment_method, style,
    participant_count, participant_ages, dates, archive,
  } = req.body || {};

  if (!['recurring', 'dates'].includes(mode)) return res.status(400).json({ error: 'mode must be recurring or dates' });
  if (!start_time) return res.status(400).json({ error: 'A start time is required' });

  // ── who is this for
  let clientId = client_id || entry.client_id || null;
  if (!clientId) {
    if (!create_client) return res.status(400).json({ error: 'Pick an existing client, or let this create one.' });
    const name = (entry.client_name || '').trim();
    if (!name) return res.status(400).json({ error: 'This entry has no client name to create a client from.' });
    const { rows: [existing] } = await pool.query(
      'SELECT id, phone, street, neighborhood, rate_per_class FROM clients WHERE LOWER(name) = LOWER($1)', [name]
    );
    if (existing) {
      clientId = existing.id;
      // A client record already existed under this name — reuse it rather than creating a
      // duplicate, but fill in anything the recruiting call captured that the record is
      // still missing. COALESCE order matters: never overwrite what's already there.
      await pool.query(
        `UPDATE clients SET
           phone          = COALESCE(NULLIF(TRIM(COALESCE(phone,'')),''), $2),
           street         = COALESCE(NULLIF(TRIM(COALESCE(street,'')),''), $3),
           neighborhood   = COALESCE(NULLIF(TRIM(COALESCE(neighborhood,'')),''), $4),
           rate_per_class = COALESCE(NULLIF(TRIM(COALESCE(rate_per_class,'')),''), $5)
         WHERE id = $1`,
        [clientId, entry.phone || null, (entry.address || '').trim() || null,
         entry.neighborhood || null, entry.client_rate || null]
      );
    } else {
      const { rows: [created] } = await pool.query(
        `INSERT INTO clients (name, phone, street, neighborhood, rate_per_class, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [name, entry.phone || null, (entry.address || '').trim() || null,
         entry.neighborhood || null, entry.client_rate || null,
         entry.class_notes || null]
      );
      clientId = created.id;
    }
  }

  const instructorId = instructor_id || entry.instructor_id || null;
  const mins = duration_minutes || 60;
  const created = { schedule_ids: [], session_ids: [] };

  if (mode === 'recurring') {
    // A class often runs several days a week ("mon wed and fri"). class_schedules holds
    // one weekday per row, which is how the rest of the app already models it, so each
    // chosen day becomes its own schedule.
    const chosen = Array.isArray(weekdays) && weekdays.length ? weekdays : (weekday != null ? [weekday] : []);
    const indexes = [...new Set(chosen
      .map(w => (typeof w === 'number' ? w : WEEKDAY_INDEX[String(w || '').toLowerCase()]))
      .filter(w => w !== undefined && w !== null))];
    if (indexes.length === 0) return res.status(400).json({ error: 'Pick at least one day of the week.' });

    for (const wd of indexes) {
      const { rows: [sch] } = await pool.query(
        `INSERT INTO class_schedules
           (client_id, instructor_id, weekday, start_time, duration_minutes, charge_amount,
            instructor_pay, payment_method, style, status, start_date, participant_count, participant_ages)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12) RETURNING id`,
        [clientId, instructorId, wd, start_time, mins, charge_amount ?? null, instructor_pay ?? null,
         payment_method || null, style || entry.style || null,
         Array.isArray(dates) && dates[0] ? dates[0] : null,
         participant_count ?? null, participant_ages || entry.participants || null]
      );
      created.schedule_ids.push(sch.id);
      // Fill the calendar straight away rather than waiting on the nightly run, same as
      // creating a schedule from the Schedule page does.
      await generateUpcomingSessions(defaultHorizon(), { scheduleId: sch.id });
    }
  } else {
    if (!Array.isArray(dates) || dates.length === 0) return res.status(400).json({ error: 'Pick at least one date.' });
    for (const d of dates) {
      // A blank payment method means the class never comes off a package and never
      // reaches an invoice, so fall back to how this client's other classes bill.
      const method = payment_method || await usualPaymentMethodFor(clientId);
      const { rows: [row] } = await pool.query(
        `INSERT INTO class_sessions
           (client_id, instructor_id, session_date, start_time, duration_minutes, charge_amount,
            instructor_pay, payment_method, style, status, participant_count, participant_ages)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11) RETURNING id`,
        [clientId, instructorId, d, start_time, mins, charge_amount ?? null, instructor_pay ?? null,
         method || null, style || entry.style || null,
         participant_count ?? null, participant_ages || entry.participants || null]
      );
      created.session_ids.push(row.id);
    }
  }

  // Point the entry at whatever client it ended up on, so the link isn't lost.
  await pool.query('UPDATE recruiting_entries SET client_id = $1 WHERE id = $2', [clientId, req.params.id]);
  if (archive) await pool.query('UPDATE recruiting_entries SET archived = 1 WHERE id = $1', [req.params.id]);

  res.status(201).json({ ...created, client_id: clientId, archived: !!archive });
});

router.get('/styles', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM class_styles ORDER BY name');
  res.json(rows);
});

router.post('/styles', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows: [style] } = await pool.query('INSERT INTO class_styles (name) VALUES ($1) RETURNING *', [name.trim()]);
    res.status(201).json(style);
  } catch {
    res.status(409).json({ error: 'Style already exists' });
  }
});

// instructors.styles_taught is a comma-separated free-text copy of style names (not a
// foreign key), so renaming/deleting a style in the master class_styles list leaves
// every instructor's copy of the old name sitting there unless something goes and fixes
// it up. This does that: newName=null strips the style out entirely (delete), a string
// swaps the old name for the new one in place (rename) — so the change staff make once
// here is what shows up on every instructor profile, not just future ones.
async function propagateStyleRename(oldName, newName) {
  const { rows } = await pool.query(
    `SELECT id, styles_taught FROM instructors WHERE styles_taught ILIKE $1`,
    [`%${oldName}%`]
  );
  for (const row of rows) {
    const names = row.styles_taught.split(',').map(s => s.trim()).filter(Boolean);
    if (!names.some(n => n.toLowerCase() === oldName.toLowerCase())) continue;
    const updated = names
      .map(n => n.toLowerCase() === oldName.toLowerCase() ? newName : n)
      .filter(Boolean);
    const deduped = [...new Set(updated)];
    await pool.query('UPDATE instructors SET styles_taught = $1 WHERE id = $2', [deduped.join(', ') || null, row.id]);
  }
}

router.put('/styles/:id', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows: [existing] } = await pool.query('SELECT id, name FROM class_styles WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { rows: [style] } = await pool.query('UPDATE class_styles SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), req.params.id]);
  if (existing.name !== style.name) await propagateStyleRename(existing.name, style.name);
  res.json(style);
});

router.delete('/styles/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT name FROM class_styles WHERE id = $1', [req.params.id]);
  await pool.query('DELETE FROM class_styles WHERE id = $1', [req.params.id]);
  if (existing) await propagateStyleRename(existing.name, null);
  res.json({ success: true });
});

// ── Recruiting columns ────────────────────────────────────────────────────────

router.get('/columns', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM recruiting_columns ORDER BY display_order ASC');
  res.json(rows);
});

router.post('/columns', async (req, res) => {
  const { name, field_key, display_order } = req.body;
  const { rows: [col] } = await pool.query(
    'INSERT INTO recruiting_columns (name, field_key, display_order) VALUES ($1,$2,$3) RETURNING *',
    [name, field_key || null, display_order ?? 0]
  );
  res.status(201).json(col);
});

router.put('/columns/:id', async (req, res) => {
  const { name, field_key, display_order } = req.body;
  const { rows: [col] } = await pool.query(
    'UPDATE recruiting_columns SET name=$1, field_key=$2, display_order=$3 WHERE id=$4 RETURNING *',
    [name, field_key || null, display_order ?? 0, req.params.id]
  );
  if (!col) return res.status(404).json({ error: 'Not found' });
  res.json(col);
});

router.delete('/columns/:id', async (req, res) => {
  await pool.query('DELETE FROM recruiting_columns WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
