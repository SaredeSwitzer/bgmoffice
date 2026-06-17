const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

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

function getEntry(id) {
  const entry = db.prepare(`${ENTRY_JOIN} WHERE re.id = ?`).get(id);
  if (!entry) return null;
  entry.notes = db.prepare(
    'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
  ).all(id);
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

  const notesByEntry = {};
  db.prepare('SELECT * FROM recruiting_notes ORDER BY created_at ASC').all()
    .forEach(n => {
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
    e.notes = db.prepare(
      'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
    ).all(e.id);
  });
  res.json(entries);
});

router.post('/entries', (req, res) => {
  const {
    day_of_week, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates,
  } = req.body;
  if (!day_of_week || !DAYS.includes(day_of_week))
    return res.status(400).json({ error: 'Valid day_of_week required' });

  const result = db.prepare(`
    INSERT INTO recruiting_entries
      (day_of_week, time_slot, neighborhood, style, participants,
       client_name, client_id, address, phone, waiver_signed,
       instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id, created_by,
       class_type, class_dates)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    day_of_week,
    time_slot           || null,
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
  );
  res.status(201).json(getEntry(result.lastInsertRowid));
});

router.put('/entries/:id', (req, res) => {
  const entry = db.prepare('SELECT id FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const {
    day_of_week, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, instructor_id, client_rate, action_type_id, assigned_to_user_id,
    class_type, class_dates,
  } = req.body;

  db.prepare(`
    UPDATE recruiting_entries SET
      day_of_week=?, time_slot=?, neighborhood=?, style=?, participants=?,
      client_name=?, client_id=?, address=?, phone=?, waiver_signed=?,
      instructor_info=?, instructor_id=?, client_rate=?, action_type_id=?, assigned_to_user_id=?,
      class_type=?, class_dates=?
    WHERE id=?
  `).run(
    day_of_week         || null,
    time_slot           || null,
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
  const { text, is_task, assigned_to, client_id, instructor_id, action_type_id } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const entry = db.prepare('SELECT * FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const noteResult = db.prepare(
    'INSERT INTO recruiting_notes (entry_id, text, author_initials, is_task, assigned_to) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, text.trim(), req.user.initials, is_task ? 1 : 0, assigned_to || null);

  let note = db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(noteResult.lastInsertRowid);

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
      assigned_to    || null,
      context        || null,
      req.user.initials,
      note.id,
      client_id      || null,
      instructor_id  || null,
      action_type_id || null,
    );

    db.prepare('UPDATE recruiting_notes SET standalone_task_id = ? WHERE id = ?')
      .run(taskResult.lastInsertRowid, note.id);
    note = db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(note.id);
  }

  res.status(201).json(note);
});

router.put('/entries/:id/notes/:noteId', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  const { text, assigned_to } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

  db.prepare('UPDATE recruiting_notes SET text = ?, assigned_to = ? WHERE id = ?')
    .run(text.trim(), assigned_to || null, note.id);

  if (note.standalone_task_id) {
    db.prepare('UPDATE standalone_tasks SET title = ?, assigned_to = ? WHERE id = ?')
      .run(text.trim(), assigned_to || null, note.standalone_task_id);
  }

  res.json(db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(note.id));
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
    SELECT ia.*, i.name AS instructor_name
    FROM instructor_availability ia
    JOIN instructors i ON i.id = ia.instructor_id
    ORDER BY i.name, ia.day_of_week, ia.time_slot
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

router.delete('/availability/:id', (req, res) => {
  db.prepare('DELETE FROM instructor_availability WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
