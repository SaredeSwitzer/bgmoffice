const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DAYS = ['Flexible','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

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
  const { text, is_task, assigned_to, client_id, instructor_id, action_type_ids } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const { rows: [entry] } = await pool.query('SELECT * FROM recruiting_entries WHERE id = $1', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const { rows: [note] } = await pool.query(
    'INSERT INTO recruiting_notes (entry_id, text, author_initials, is_task, assigned_to) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.id, text.trim(), req.user.initials, is_task ? 1 : 0, assigned_to || null]
  );

  const atIds = Array.isArray(action_type_ids) ? action_type_ids.map(Number).filter(Boolean) : [];
  if (atIds.length) {
    await Promise.all(atIds.map(atId =>
      pool.query('INSERT INTO recruiting_note_action_types (note_id, action_type_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [note.id, atId])
    ));
  }

  if (is_task) {
    const context = [
      entry.client_name ? `Client: ${entry.client_name}` : null,
      entry.day_of_week,
      entry.time_slot || null,
    ].filter(Boolean).join(' · ');

    const { rows: [task] } = await pool.query(
      `INSERT INTO standalone_tasks (title, assigned_to, notes, created_by, recruiting_note_id, client_id, instructor_id, action_type_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [text.trim(), assigned_to || null, context || null, req.user.initials, note.id, client_id || null, instructor_id || null, atIds[0] || null]
    );
    await pool.query('UPDATE recruiting_notes SET standalone_task_id = $1 WHERE id = $2', [task.id, note.id]);
  }

  const { rows: [updated] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1', [note.id]);
  const { rows: actionTypes } = await pool.query(
    `SELECT at.id, at.name, at.color FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id WHERE rnat.note_id = $1`,
    [note.id]
  );
  updated.action_types = actionTypes;
  res.status(201).json(updated);
});

router.put('/entries/:id/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1 AND entry_id = $2', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const { text, assigned_to, action_type_ids } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

  await pool.query('UPDATE recruiting_notes SET text = $1, assigned_to = $2 WHERE id = $3', [text.trim(), assigned_to || null, note.id]);

  if (Array.isArray(action_type_ids)) {
    const atIds = action_type_ids.map(Number).filter(Boolean);
    await pool.query('DELETE FROM recruiting_note_action_types WHERE note_id = $1', [note.id]);
    await Promise.all(atIds.map(atId =>
      pool.query('INSERT INTO recruiting_note_action_types (note_id, action_type_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [note.id, atId])
    ));
    if (note.standalone_task_id) {
      await pool.query('UPDATE standalone_tasks SET action_type_id = $1 WHERE id = $2', [atIds[0] || null, note.standalone_task_id]);
    }
  }

  if (note.standalone_task_id) {
    await pool.query('UPDATE standalone_tasks SET title = $1, assigned_to = $2 WHERE id = $3', [text.trim(), assigned_to || null, note.standalone_task_id]);
  }

  const { rows: [updated] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1', [note.id]);
  const { rows: actionTypes } = await pool.query(
    `SELECT at.id, at.name, at.color FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id WHERE rnat.note_id = $1`,
    [note.id]
  );
  updated.action_types = actionTypes;
  res.json(updated);
});

router.patch('/entries/:id/notes/:noteId/done', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1 AND entry_id = $2', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const newDone = note.is_done ? 0 : 1;
  await pool.query('UPDATE recruiting_notes SET is_done = $1 WHERE id = $2', [newDone, req.params.noteId]);

  if (note.standalone_task_id) {
    await pool.query(
      'UPDATE standalone_tasks SET status = $1, completed_at = $2 WHERE id = $3',
      [newDone ? 'done' : 'open', newDone ? new Date().toISOString() : null, note.standalone_task_id]
    );
  }
  res.json({ ...note, is_done: newDone });
});

router.delete('/entries/:id/notes/:noteId', async (req, res) => {
  const { rows: [note] } = await pool.query('SELECT * FROM recruiting_notes WHERE id = $1 AND entry_id = $2', [req.params.noteId, req.params.id]);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.standalone_task_id) {
    await pool.query('DELETE FROM standalone_tasks WHERE id = $1', [note.standalone_task_id]);
  }
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

router.put('/styles/:id', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows: [existing] } = await pool.query('SELECT id FROM class_styles WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { rows: [style] } = await pool.query('UPDATE class_styles SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), req.params.id]);
  res.json(style);
});

router.delete('/styles/:id', async (req, res) => {
  await pool.query('DELETE FROM class_styles WHERE id = $1', [req.params.id]);
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
