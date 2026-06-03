const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET all sections ordered by display_order
router.get('/', (req, res) => {
  const sections = db.prepare(
    'SELECT * FROM reference_sections ORDER BY display_order ASC, id ASC'
  ).all();
  res.json(sections);
});

// POST new section (admin only)
router.post('/', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { title, content, display_order } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  // Default display_order to end of list
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(display_order), 0) AS m FROM reference_sections'
  ).get().m;

  const result = db.prepare(
    `INSERT INTO reference_sections (title, content, display_order, created_by)
     VALUES (?, ?, ?, ?)`
  ).run(
    title.trim(),
    content ?? '',
    display_order ?? maxOrder + 1,
    req.user.name,
  );
  res.status(201).json(db.prepare('SELECT * FROM reference_sections WHERE id = ?').get(result.lastInsertRowid));
});

// PUT update section (admin only)
router.put('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const row = db.prepare('SELECT id FROM reference_sections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Section not found' });

  const { title, content, display_order } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  db.prepare(
    `UPDATE reference_sections
     SET title=?, content=?, display_order=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(title.trim(), content ?? '', display_order ?? 0, req.params.id);
  res.json(db.prepare('SELECT * FROM reference_sections WHERE id = ?').get(req.params.id));
});

// PATCH reorder — expects body: { items: [{id, display_order}] }
router.patch('/reorder', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const stmt = db.prepare('UPDATE reference_sections SET display_order=? WHERE id=?');
  const updateAll = db.transaction(() => items.forEach(({ id, display_order }) => stmt.run(display_order, id)));
  updateAll();
  res.json({ ok: true });
});

// DELETE section (admin only)
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const result = db.prepare('DELETE FROM reference_sections WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Section not found' });
  res.json({ success: true });
});

module.exports = router;
