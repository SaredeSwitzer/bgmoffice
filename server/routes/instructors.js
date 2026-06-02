const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(
      'SELECT * FROM instructors WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR specialties LIKE ? ORDER BY name'
    ).all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM instructors ORDER BY name').all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const instructor = db.prepare('SELECT * FROM instructors WHERE id = ?').get(req.params.id);
  if (!instructor) return res.status(404).json({ error: 'Instructor not found' });
  res.json(instructor);
});

router.post('/', (req, res) => {
  const { name, phone, email, specialties, style, notes, pay_rate } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    'INSERT INTO instructors (name, phone, email, specialties, style, notes, pay_rate) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null);
  res.status(201).json(db.prepare('SELECT * FROM instructors WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const instructor = db.prepare('SELECT id FROM instructors WHERE id = ?').get(req.params.id);
  if (!instructor) return res.status(404).json({ error: 'Instructor not found' });
  const { name, phone, email, specialties, style, notes, pay_rate } = req.body;
  db.prepare(
    'UPDATE instructors SET name=?, phone=?, email=?, specialties=?, style=?, notes=?, pay_rate=? WHERE id=?'
  ).run(name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, req.params.id);
  res.json(db.prepare('SELECT * FROM instructors WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const instructor = db.prepare('SELECT id FROM instructors WHERE id = ?').get(req.params.id);
  if (!instructor) return res.status(404).json({ error: 'Instructor not found' });
  db.prepare('DELETE FROM instructors WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
