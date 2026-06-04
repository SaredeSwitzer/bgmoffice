const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ── Action Types ──────────────────────────────────────────────────────────────
router.get('/action-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM action_types ORDER BY order_index ASC').all());
});

router.post('/action-types', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM action_types').get().m || 0;
  const result = db.prepare(
    'INSERT INTO action_types (name, color, order_index) VALUES (?, ?, ?)'
  ).run(name, color || 'gray', maxOrder + 1);
  res.status(201).json(db.prepare('SELECT * FROM action_types WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/action-types/:id', (req, res) => {
  const { name, color, order_index } = req.body;
  const at = db.prepare('SELECT id FROM action_types WHERE id = ?').get(req.params.id);
  if (!at) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE action_types SET name=?, color=?, order_index=? WHERE id=?')
    .run(name, color, order_index, req.params.id);
  res.json(db.prepare('SELECT * FROM action_types WHERE id = ?').get(req.params.id));
});

router.delete('/action-types/:id', (req, res) => {
  const result = db.prepare('DELETE FROM action_types WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Reorder: accepts array of { id, order_index }
router.patch('/action-types/reorder', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const update = db.prepare('UPDATE action_types SET order_index=? WHERE id=?');
  db.transaction(() => items.forEach(({ id, order_index }) => update.run(order_index, id)))();
  res.json(db.prepare('SELECT * FROM action_types ORDER BY order_index ASC').all());
});

// ── Delegates ─────────────────────────────────────────────────────────────────
router.get('/delegates', (req, res) => {
  res.json(db.prepare('SELECT * FROM delegates ORDER BY name').all());
});

router.post('/delegates', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO delegates (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM delegates WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/delegates/:id', (req, res) => {
  const { name } = req.body;
  const result = db.prepare('UPDATE delegates SET name=? WHERE id=?').run(name, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json(db.prepare('SELECT * FROM delegates WHERE id = ?').get(req.params.id));
});

router.delete('/delegates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM delegates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  res.json(db.prepare('SELECT id, name, initials, email, role, active, created_at FROM users ORDER BY name').all());
});

router.post('/users', (req, res) => {
  const { name, initials, email, password, role } = req.body;
  if (!name || !initials || !email || !password || !role) {
    return res.status(400).json({ error: 'name, initials, email, password, role required' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, initials, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run(name, initials, email, password_hash, role);
  res.status(201).json(
    db.prepare('SELECT id, name, initials, email, role, active FROM users WHERE id = ?').get(result.lastInsertRowid)
  );
});

router.put('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, initials, email, role, password } = req.body;
  if (password) {
    const password_hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, initials=?, email=?, role=?, password_hash=? WHERE id=?')
      .run(name, initials, email, role, password_hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, initials=?, email=?, role=? WHERE id=?')
      .run(name, initials, email, role, req.params.id);
  }
  res.json(db.prepare('SELECT id, name, initials, email, role, active FROM users WHERE id = ?').get(req.params.id));
});

router.patch('/users/:id/active', (req, res) => {
  const { active } = req.body;
  const result = db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json(db.prepare('SELECT id, name, initials, email, role, active FROM users WHERE id = ?').get(req.params.id));
});

// ── Stripe settings ───────────────────────────────────────────────────────────

router.get('/stripe', (req, res) => {
  const pub = db.prepare("SELECT value FROM app_settings WHERE key='stripe_publishable_key'").get()?.value || '';
  const hasSecret = !!(
    db.prepare("SELECT value FROM app_settings WHERE key='stripe_secret_key'").get()?.value ||
    process.env.STRIPE_SECRET_KEY
  );
  res.json({ publishable_key: pub, secret_key_set: hasSecret });
});

router.post('/stripe', (req, res) => {
  const { publishable_key, secret_key, webhook_secret } = req.body;
  const upsert = db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  );
  if (publishable_key !== undefined) upsert.run('stripe_publishable_key', publishable_key);
  if (secret_key) upsert.run('stripe_secret_key', secret_key);
  if (webhook_secret) upsert.run('stripe_webhook_secret', webhook_secret);
  res.json({ ok: true });
});

module.exports = router;
