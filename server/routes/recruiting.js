const express = require('express');
const db      = require('../db');
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

function attachNoteActionTypes(notes) {
  if (!notes.length) return notes;
  const ids = notes.map(n => n.id);
  const rows = db.prepare(
    `SELECT rnat.note_id, at.id, at.name, at.color
     FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id
     WHERE rnat.note_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const byNote = {};
  rows.forEach(r => {
    if (!byNote[r.note_id]) byNote[r.note_id] = [];
    byNote[r.note_id].push({ id: r.id, name: r.name, color: r.color });
  });
  return notes.map(n => ({ ...n, action_types: byNote[n.id] || [] }));
}

function getEntry(id) {
  const entry = db.prepare(`${ENTRY_JOIN} WHERE re.id = ?`).get(id);
  if (!entry) return null;
  const notes = db.prepare(
    'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
  ).all(id);
  entry.notes = attachNoteActionTypes(notes);
  return entry;
}

// ── Entries ───────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { q, archived } = req.query;
  const showArchived = archived === '1';
  const archivedCond = showArchived ? 're.archived = 1' : 're.archived = 0';
  let entries;
  if (q) {
    const like = `%${q}%`;
    entries = db.prepare(`
      ${ENTRY_JOIN}
      WHERE (${archivedCond}) AND (
        re.time_slot LIKE ? OR re.neighborhood LIKE ? OR re.style LIKE ?
        OR re.participants LIKE ? OR re.client_name LIKE ? OR re.address LIKE ?
        OR re.phone LIKE ? OR re.instructor_info LIKE ? OR re.client_rate LIKE ?
        OR i.name LIKE ?
      )
      ORDER BY re.day_of_week, re.created_at
    `).all(like, like, like, like, like, like, like, like, like, like);
  } else {
    entries = db.prepare(`${ENTRY_JOIN} WHERE ${archivedCond} ORDER BY re.created_at ASC`).all();
  }

  const allNotes = db.prepare('SELECT * FROM recruiting_notes ORDER BY created_at ASC').all();
  const withTypes = attachNoteActionTypes(allNotes);
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

router.get('/client/:clientId', (req, res) => {
  const entries = db.prepare(`${ENTRY_JOIN} WHERE re.client_id = ? ORDER BY re.created_at DESC`)
    .all(req.params.clientId);
  entries.forEach(e => {
    const notes = db.prepare(
      'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
    ).all(e.id);
    e.notes = attachNoteActionTypes(notes);
  });
  res.json(entries);
});

router.get('/instructor/:instructorId', (req, res) => {
  const entries = db.prepare(`${ENTRY_JOIN} WHERE re.instructor_id = ? ORDER BY re.created_at DESC`)
    .all(req.params.instructorId);
  entries.forEach(e => {
    const notes = db.prepare(
      'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
    ).all(e.id);
    e.notes = attachNoteActionTypes(notes);
  });
  res.json(entries);
});

// Derive day_of_week from preferred_days array: single → that day, multiple → Flexible
function resolveDayOfWeek(preferredDays, explicitDay) {
  if (Array.isArray(preferredDays) && preferredDays.length > 0) {
    return preferredDays.length === 1 ? preferredDays[0].day : 'Flexible';
  }
  return explicitDay || 'Flexible';
}

router.post('/entries', (req, res) => {
  const {
    preferred_days, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates, class_notes,
  } = req.body;

  const day_of_week = resolveDayOfWeek(preferred_days, req.body.day_of_week);
  if (!DAYS.includes(day_of_week))
    return res.status(400).json({ error: 'Valid day_of_week required' });

  // For single-day entries, pull the time from preferred_days if not given separately
  const resolvedTime = time_slot ||
    (Array.isArray(preferred_days) && preferred_days.length === 1 ? preferred_days[0].time : null);

  const result = db.prepare(`
    INSERT INTO recruiting_entries
      (day_of_week, time_slot, neighborhood, style, participants,
       client_name, client_id, address, phone, waiver_signed,
       instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id, created_by,
       class_type, class_dates, class_notes, preferred_days)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    day_of_week,
    resolvedTime        || null,
    neighborhood        || null,
    style               || null,
    participants        || null,
    client_name         || null,
    client_id           || null,
    address             || null,
    phone               || null,
    waiver_signed       ? 1 : 0,
    instructor_info     || null,
    instructor_id       || null,
    client_rate         || null,
    action_type_id      || null,
    assigned_to_user_id || null,
    req.user.initials,
    class_type          || null,
    class_dates         || null,
    class_notes         || null,
    preferred_days ? JSON.stringify(preferred_days) : null,
  );
  res.status(201).json(getEntry(result.lastInsertRowid));
});

router.put('/entries/:id', (req, res) => {
  const entry = db.prepare('SELECT id FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const {
    preferred_days, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates, class_notes,
  } = req.body;

  const day_of_week = resolveDayOfWeek(preferred_days, req.body.day_of_week);
  const resolvedTime = time_slot ||
    (Array.isArray(preferred_days) && preferred_days.length === 1 ? preferred_days[0].time : null);

  db.prepare(`
    UPDATE recruiting_entries SET
      day_of_week=?, time_slot=?, neighborhood=?, style=?, participants=?,
      client_name=?, client_id=?, address=?, phone=?, waiver_signed=?,
      instructor_info=?, instructor_id=?, client_rate=?, action_type_id=?, assigned_to_user_id=?,
      class_type=?, class_dates=?, class_notes=?, preferred_days=?
    WHERE id=?
  `).run(
    day_of_week         || null,
    resolvedTime        || null,
    neighborhood        || null,
    style               || null,
    participants        || null,
    client_name         || null,
    client_id           || null,
    address             || null,
    phone               || null,
    waiver_signed       ? 1 : 0,
    instructor_info     || null,
    instructor_id       || null,
    client_rate         || null,
    action_type_id      || null,
    assigned_to_user_id || null,
    class_type          || null,
    class_dates         || null,
    class_notes         || null,
    preferred_days ? JSON.stringify(preferred_days) : null,
    req.params.id,
  );
  res.json(getEntry(req.params.id));
});

router.delete('/entries/:id', (req, res) => {
  const entry = db.prepare('SELECT id FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM recruiting_entries WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/entries/:id/archive', (req, res) => {
  const entry = db.prepare('SELECT id, archived FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const newArchived = entry.archived ? 0 : 1;
  db.prepare('UPDATE recruiting_entries SET archived = ? WHERE id = ?').run(newArchived, req.params.id);
  res.json(getEntry(req.params.id));
});

// ── Notes ─────────────────────────────────────────────────────────────────────

router.post('/entries/:id/notes', (req, res) => {
  const { text, is_task, assigned_to, client_id, instructor_id, action_type_ids } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const entry = db.prepare('SELECT * FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const noteResult = db.prepare(
    'INSERT INTO recruiting_notes (entry_id, text, author_initials, is_task, assigned_to) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, text.trim(), req.user.initials, is_task ? 1 : 0, assigned_to || null);

  let note = db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(noteResult.lastInsertRowid);

  const atIds = Array.isArray(action_type_ids) ? action_type_ids.map(Number).filter(Boolean) : [];
  if (atIds.length) {
    const insAt = db.prepare('INSERT OR IGNORE INTO recruiting_note_action_types (note_id, action_type_id) VALUES (?, ?)');
    atIds.forEach(atId => insAt.run(note.id, atId));
  }

  if (is_task) {
    const context = [
      entry.client_name ? `Client: ${entry.client_name}` : null,
      entry.day_of_week,
      entry.time_slot || null,
    ].filter(Boolean).join(' · ');

    const taskResult = db.prepare(`
      INSERT INTO standalone_tasks (title, assigned_to, notes, created_by, recruiting_note_id, client_id, instructor_id, action_type_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      text.trim(),
      assigned_to || null,
      context     || null,
      req.user.initials,
      note.id,
      client_id   || null,
      instructor_id || null,
      atIds[0]    || null,
    );

    db.prepare('UPDATE recruiting_notes SET standalone_task_id = ? WHERE id = ?')
      .run(taskResult.lastInsertRowid, note.id);
    note = db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(note.id);
  }

  note.action_types = db.prepare(
    `SELECT at.id, at.name, at.color FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id WHERE rnat.note_id = ?`
  ).all(note.id);

  res.status(201).json(note);
});

router.put('/entries/:id/notes/:noteId', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const { text, assigned_to, action_type_ids } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

  db.prepare('UPDATE recruiting_notes SET text = ?, assigned_to = ? WHERE id = ?')
    .run(text.trim(), assigned_to || null, note.id);

  if (Array.isArray(action_type_ids)) {
    const atIds = action_type_ids.map(Number).filter(Boolean);
    db.prepare('DELETE FROM recruiting_note_action_types WHERE note_id = ?').run(note.id);
    const insAt = db.prepare('INSERT OR IGNORE INTO recruiting_note_action_types (note_id, action_type_id) VALUES (?, ?)');
    atIds.forEach(atId => insAt.run(note.id, atId));

    if (note.standalone_task_id) {
      db.prepare('UPDATE standalone_tasks SET action_type_id = ? WHERE id = ?')
        .run(atIds[0] || null, note.standalone_task_id);
    }
  }

  if (note.standalone_task_id) {
    db.prepare('UPDATE standalone_tasks SET title = ?, assigned_to = ? WHERE id = ?')
      .run(text.trim(), assigned_to || null, note.standalone_task_id);
  }

  const updated = db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(note.id);
  updated.action_types = db.prepare(
    `SELECT at.id, at.name, at.color FROM recruiting_note_action_types rnat
     JOIN action_types at ON at.id = rnat.action_type_id WHERE rnat.note_id = ?`
  ).all(note.id);
  res.json(updated);
});

router.patch('/entries/:id/notes/:noteId/done', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const newDone = note.is_done ? 0 : 1;
  db.prepare('UPDATE recruiting_notes SET is_done = ? WHERE id = ?').run(newDone, req.params.noteId);

  if (note.standalone_task_id) {
    db.prepare('UPDATE standalone_tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      newDone ? 'done' : 'open',
      newDone ? new Date().toISOString() : null,
      note.standalone_task_id
    );
  }

  res.json({ ...note, is_done: newDone });
});

router.delete('/entries/:id/notes/:noteId', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  if (note.standalone_task_id) {
    db.prepare('DELETE FROM standalone_tasks WHERE id = ?').run(note.standalone_task_id);
  }
  db.prepare('DELETE FROM recruiting_notes WHERE id = ?').run(req.params.noteId);
  res.json({ success: true });
});

// ── Instructor Availability ───────────────────────────────────────────────────

router.get('/availability', (req, res) => {
  const rows = db.prepare(`
    SELECT ia.*,
           i.name         AS instructor_name,
           i.neighborhood AS instructor_neighborhood,
           i.specialties  AS instructor_specialties,
           i.style        AS instructor_style,
           i.styles_taught AS instructor_styles_taught
    FROM instructor_availability ia
    JOIN instructors i ON i.id = ia.instructor_id
    ORDER BY ia.day_of_week, ia.time_slot, i.name
  `).all();
  res.json(rows);
});

router.post('/availability', (req, res) => {
  const { instructor_id, day_of_week, time_slot } = req.body;
  if (!instructor_id || !day_of_week)
    return res.status(400).json({ error: 'instructor_id and day_of_week required' });
  const result = db.prepare(
    'INSERT INTO instructor_availability (instructor_id, day_of_week, time_slot) VALUES (?, ?, ?)'
  ).run(instructor_id, day_of_week, time_slot || null);
  const row = db.prepare(`
    SELECT ia.*, i.name AS instructor_name
    FROM instructor_availability ia JOIN instructors i ON i.id = ia.instructor_id
    WHERE ia.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/availability/:id', (req, res) => {
  const slot = db.prepare('SELECT id FROM instructor_availability WHERE id = ?').get(req.params.id);
  if (!slot) return res.status(404).json({ error: 'Not found' });
  const { day_of_week, time_slot } = req.body;
  if (!day_of_week) return res.status(400).json({ error: 'day_of_week required' });
  db.prepare('UPDATE instructor_availability SET day_of_week = ?, time_slot = ? WHERE id = ?')
    .run(day_of_week, time_slot || null, req.params.id);
  const row = db.prepare(`
    SELECT ia.*,
           i.name         AS instructor_name,
           i.neighborhood AS instructor_neighborhood,
           i.specialties  AS instructor_specialties,
           i.style        AS instructor_style
    FROM instructor_availability ia
    JOIN instructors i ON i.id = ia.instructor_id
    WHERE ia.id = ?
  `).get(req.params.id);
  res.json(row);
});

router.delete('/availability/:id', (req, res) => {
  db.prepare('DELETE FROM instructor_availability WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Class Styles ──────────────────────────────────────────────────────────────

router.get('/styles', (req, res) => {
  res.json(db.prepare('SELECT * FROM class_styles ORDER BY name').all());
});

router.post('/styles', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const result = db.prepare('INSERT INTO class_styles (name) VALUES (?)').run(name.trim());
    res.status(201).json(db.prepare('SELECT * FROM class_styles WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Style already exists' });
  }
});

router.put('/styles/:id', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const row = db.prepare('SELECT id FROM class_styles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE class_styles SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM class_styles WHERE id = ?').get(req.params.id));
});

router.delete('/styles/:id', (req, res) => {
  db.prepare('DELETE FROM class_styles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
