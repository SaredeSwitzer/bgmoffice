const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');
const { sendMail } = require('../lib/mailer');

const router = express.Router();
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

router.post('/entries', async (req, res) => {
  const {
    preferred_days, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates, class_notes,
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
        class_type, class_dates, class_notes, preferred_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
    [
      day_of_week, resolvedTime || null, neighborhood || null, style || null, participants || null,
      client_name || null, client_id || null, address || null, phone || null, waiver_signed ? 1 : 0,
      instructor_info || null, instructor_id || null, client_rate || null,
      action_type_id || null, assigned_to_user_id || null, req.user.initials,
      class_type || null, class_dates || null, class_notes || null,
      preferred_days ? JSON.stringify(preferred_days) : null,
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
    class_type, class_dates, class_notes,
  } = req.body;

  const day_of_week = resolveDayOfWeek(preferred_days, req.body.day_of_week);
  const resolvedTime = time_slot ||
    (Array.isArray(preferred_days) && preferred_days.length === 1 ? preferred_days[0].time : null);

  await pool.query(
    `UPDATE recruiting_entries SET
       day_of_week=$1, time_slot=$2, neighborhood=$3, style=$4, participants=$5,
       client_name=$6, client_id=$7, address=$8, phone=$9, waiver_signed=$10,
       instructor_info=$11, instructor_id=$12, client_rate=$13, action_type_id=$14, assigned_to_user_id=$15,
       class_type=$16, class_dates=$17, class_notes=$18, preferred_days=$19
     WHERE id=$20`,
    [
      day_of_week || null, resolvedTime || null, neighborhood || null, style || null, participants || null,
      client_name || null, client_id || null, address || null, phone || null, waiver_signed ? 1 : 0,
      instructor_info || null, instructor_id || null, client_rate || null,
      action_type_id || null, assigned_to_user_id || null,
      class_type || null, class_dates || null, class_notes || null,
      preferred_days ? JSON.stringify(preferred_days) : null,
      req.params.id,
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

  await pool.query('UPDATE recruiting_notes SET text = $1 WHERE id = $2', [text.trim(), note.id]);

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
