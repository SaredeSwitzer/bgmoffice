const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// List all clients (with search)
router.get('/', (req, res) => {
  const { q } = req.query;
  let clients;
  if (q) {
    const like = `%${q}%`;
    clients = db.prepare(
      'SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name'
    ).all(like, like, like);
  } else {
    clients = db.prepare('SELECT * FROM clients ORDER BY name').all();
  }
  res.json(clients);
});

// Get single client with prefs
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const prefs = db.prepare(`
    SELECT cip.*, i.name AS instructor_name
    FROM client_instructor_prefs cip
    JOIN instructors i ON i.id = cip.instructor_id
    WHERE cip.client_id = ?
  `).all(req.params.id);

  res.json({ ...client, prefs });
});

// Create client
router.post('/', (req, res) => {
  const { name, phone, email, preferred_contact, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare(
    'INSERT INTO clients (name, phone, email, preferred_contact, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(name, phone || null, email || null, preferred_contact || null, notes || null);
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid));
});

// Update client
router.put('/:id', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const { name, phone, email, preferred_contact, notes } = req.body;
  db.prepare(
    'UPDATE clients SET name=?, phone=?, email=?, preferred_contact=?, notes=? WHERE id=?'
  ).run(name, phone || null, email || null, preferred_contact || null, notes || null, req.params.id);
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
});

// Delete client
router.delete('/:id', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Add instructor preference
router.post('/:id/prefs', (req, res) => {
  const { instructor_id, preference, reason } = req.body;
  if (!instructor_id || !preference) return res.status(400).json({ error: 'instructor_id and preference required' });
  // Upsert: remove existing pref for same pair, then insert
  db.prepare('DELETE FROM client_instructor_prefs WHERE client_id = ? AND instructor_id = ?')
    .run(req.params.id, instructor_id);
  const result = db.prepare(
    'INSERT INTO client_instructor_prefs (client_id, instructor_id, preference, reason, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, instructor_id, preference, reason || null, req.user.initials);
  res.status(201).json(db.prepare('SELECT * FROM client_instructor_prefs WHERE id = ?').get(result.lastInsertRowid));
});

// Delete instructor preference
router.delete('/:id/prefs/:prefId', (req, res) => {
  db.prepare('DELETE FROM client_instructor_prefs WHERE id = ? AND client_id = ?')
    .run(req.params.prefId, req.params.id);
  res.json({ success: true });
});

module.exports = router;
