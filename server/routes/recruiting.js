const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEntry(id) {
  const entry = db.prepare('SELECT * FROM recruiting_entries WHERE id = ?').get(id);
  if (!entry) return null;
  entry.notes = db.prepare(
    'SELECT * FROM recruiting_notes WHERE entry_id = ? ORDER BY created_at ASC'
  ).all(id);
  return entry;
}

// ── Columns ───────────────────────────────────────────────────────────────────

router.get('/columns', (req, res) => {
  res.json(db.prepare('SELECT * FROM recruiting_columns ORDER BY display_order ASC').all());
});

router.post('/columns', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const maxOrder = db.prepare('SELECT MAX(display_order) AS m FROM recruiting_columns').get().m ?? 0;
  const result = db.prepare(
    'INSERT INTO recruiting_columns (name, field_key, display_order, is_system) VALUES (?, NULL, ?, 0)'
  ).run(name.trim(), maxOrder + 1);
  res.status(201).json(db.prepare('SELECT * FROM recruiting_columns WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/columns/:id', (req, res) => {
  const col = db.prepare('SELECT * FROM recruiting_columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Column not found' });
  const { name, display_order } = req.body;
  db.prepare('UPDATE recruiting_columns SET name=?, display_order=? WHERE id=?')
    .run(name ?? col.name, display_order ?? col.display_order, req.params.id);
  res.json(db.prepare('SELECT * FROM recruiting_columns WHERE id = ?').get(req.params.id));
});

router.delete('/columns/:id', (req, res) => {
  const col = db.prepare('SELECT * FROM recruiting_columns WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Column not found' });
  db.prepare('DELETE FROM recruiting_columns WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Entries ───────────────────────────────────────────────────────────────────

// GET /api/recruiting  — all entries with notes, grouped by day
router.get('/', (req, res) => {
  const { q } = req.query;
  let entries;
  if (q) {
    const like = `%${q}%`;
    entries = db.prepare(`
      SELECT * FROM recruiting_entries
      WHERE time_slot LIKE ? OR neighborhood LIKE ? OR style LIKE ?
        OR participants LIKE ? OR client_name LIKE ? OR address LIKE ?
        OR phone LIKE ? OR instructor_info LIKE ? OR client_rate LIKE ?
      ORDER BY day_of_week, created_at
    `).all(like, like, like, like, like, like, like, like, like);
  } else {
    entries = db.prepare('SELECT * FROM recruiting_entries ORDER BY created_at ASC').all();
  }

  // Attach notes to each entry
  const notesByEntry = {};
  db.prepare('SELECT * FROM recruiting_notes ORDER BY created_at ASC').all()
    .forEach(n => {
      if (!notesByEntry[n.entry_id]) notesByEntry[n.entry_id] = [];
      notesByEntry[n.entry_id].push(n);
    });

  entries.forEach(e => { e.notes = notesByEntry[e.id] || []; });

  // Group by day
  const grouped = {};
  DAYS.forEach(d => { grouped[d] = []; });
  entries.forEach(e => {
    if (grouped[e.day_of_week]) grouped[e.day_of_week].push(e);
  });

  const columns = db.prepare('SELECT * FROM recruiting_columns ORDER BY display_order ASC').all();
  res.json({ grouped, columns });
});

// GET /api/recruiting/client/:clientId — entries linked to a client
router.get('/client/:clientId', (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM recruiting_entries WHERE client_id = ? ORDER BY created_at DESC'
  ).all(req.params.clientId);
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
    instructor_info, client_rate, extra_data,
  } = req.body;
  if (!day_of_week || !DAYS.includes(day_of_week))
    return res.status(400).json({ error: 'Valid day_of_week required' });

  const result = db.prepare(`
    INSERT INTO recruiting_entries
      (day_of_week, time_slot, neighborhood, style, participants,
       client_name, client_id, address, phone, waiver_signed,
       instructor_info, client_rate, extra_data, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    day_of_week,
    time_slot      || null,
    neighborhood   || null,
    style          || null,
    participants   || null,
    client_name    || null,
    client_id      || null,
    address        || null,
    phone          || null,
    waiver_signed  ? 1 : 0,
    instructor_info || null,
    client_rate    || null,
    extra_data     ? JSON.stringify(extra_data) : null,
    req.user.initials,
  );
  res.status(201).json(getEntry(result.lastInsertRowid));
});

router.put('/entries/:id', (req, res) => {
  const entry = db.prepare('SELECT id FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const {
    day_of_week, time_slot, neighborhood, style, participants,
    client_name, client_id, address, phone, waiver_signed,
    instructor_info, client_rate, extra_data,
  } = req.body;

  db.prepare(`
    UPDATE recruiting_entries SET
      day_of_week=?, time_slot=?, neighborhood=?, style=?, participants=?,
      client_name=?, client_id=?, address=?, phone=?, waiver_signed=?,
      instructor_info=?, client_rate=?, extra_data=?
    WHERE id=?
  `).run(
    day_of_week    || null,
    time_slot      || null,
    neighborhood   || null,
    style          || null,
    participants   || null,
    client_name    || null,
    client_id      || null,
    address        || null,
    phone          || null,
    waiver_signed  ? 1 : 0,
    instructor_info || null,
    client_rate    || null,
    extra_data     ? JSON.stringify(extra_data) : null,
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

// ── Notes ─────────────────────────────────────────────────────────────────────

router.post('/entries/:id/notes', (req, res) => {
  const { text, is_task, assigned_to } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const entry = db.prepare('SELECT id FROM recruiting_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  const result = db.prepare(
    'INSERT INTO recruiting_notes (entry_id, text, author_initials, is_task, assigned_to) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, text.trim(), req.user.initials, is_task ? 1 : 0, assigned_to || null);
  res.status(201).json(db.prepare('SELECT * FROM recruiting_notes WHERE id = ?').get(result.lastInsertRowid));
});

router.patch('/entries/:id/notes/:noteId/done', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const newDone = note.is_done ? 0 : 1;
  db.prepare('UPDATE recruiting_notes SET is_done = ? WHERE id = ?').run(newDone, req.params.noteId);
  res.json({ ...note, is_done: newDone });
});

router.delete('/entries/:id/notes/:noteId', (req, res) => {
  const note = db.prepare(
    'SELECT * FROM recruiting_notes WHERE id = ? AND entry_id = ?'
  ).get(req.params.noteId, req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  db.prepare('DELETE FROM recruiting_notes WHERE id = ?').run(req.params.noteId);
  res.json({ success: true });
});

module.exports = router;
