const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pg');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/action-types', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM action_types ORDER BY order_index ASC');
  res.json(rows);
});

router.post('/action-types', async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows: [max] } = await pool.query('SELECT MAX(order_index) AS m FROM action_types');
  const { rows: [at] } = await pool.query(
    'INSERT INTO action_types (name, color, order_index) VALUES ($1,$2,$3) RETURNING *',
    [name, color || 'gray', (max.m || 0) + 1]
  );
  res.status(201).json(at);
});

router.put('/action-types/:id', async (req, res) => {
  const { name, color, order_index } = req.body;
  const { rows: [existing] } = await pool.query('SELECT id FROM action_types WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { rows: [at] } = await pool.query(
    'UPDATE action_types SET name=$1, color=$2, order_index=$3 WHERE id=$4 RETURNING *',
    [name, color, order_index, req.params.id]
  );
  res.json(at);
});

router.delete('/action-types/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM action_types WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.patch('/action-types/reorder', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  await Promise.all(items.map(({ id, order_index }) =>
    pool.query('UPDATE action_types SET order_index=$1 WHERE id=$2', [order_index, id])
  ));
  const { rows } = await pool.query('SELECT * FROM action_types ORDER BY order_index ASC');
  res.json(rows);
});

router.get('/delegates', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM delegates ORDER BY name');
  res.json(rows);
});

router.post('/delegates', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows: [delegate] } = await pool.query('INSERT INTO delegates (name) VALUES ($1) RETURNING *', [name]);
  res.status(201).json(delegate);
});

router.put('/delegates/:id', async (req, res) => {
  const { name } = req.body;
  const result = await pool.query('UPDATE delegates SET name=$1 WHERE id=$2', [name, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const { rows: [delegate] } = await pool.query('SELECT * FROM delegates WHERE id = $1', [req.params.id]);
  res.json(delegate);
});

router.delete('/delegates/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM delegates WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.get('/users', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, initials, email, role, active, created_at FROM users ORDER BY name');
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { name, initials, email, password, role } = req.body;
  if (!name || !initials || !email || !password || !role)
    return res.status(400).json({ error: 'name, initials, email, password, role required' });
  const password_hash = bcrypt.hashSync(password, 10);
  const { rows: [user] } = await pool.query(
    'INSERT INTO users (name, initials, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, initials, email, role, active',
    [name, initials, email, password_hash, role]
  );
  res.status(201).json(user);
});

router.put('/users/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const { name, initials, email, role, password } = req.body;
  if (password) {
    const password_hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET name=$1, initials=$2, email=$3, role=$4, password_hash=$5 WHERE id=$6', [name, initials, email, role, password_hash, req.params.id]);
  } else {
    await pool.query('UPDATE users SET name=$1, initials=$2, email=$3, role=$4 WHERE id=$5', [name, initials, email, role, req.params.id]);
  }
  const { rows: [user] } = await pool.query('SELECT id, name, initials, email, role, active FROM users WHERE id = $1', [req.params.id]);
  res.json(user);
});

router.patch('/users/:id/active', async (req, res) => {
  const { active } = req.body;
  const result = await pool.query('UPDATE users SET active=$1 WHERE id=$2', [active ? 1 : 0, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  const { rows: [user] } = await pool.query('SELECT id, name, initials, email, role, active FROM users WHERE id = $1', [req.params.id]);
  res.json(user);
});

router.get('/stripe', async (req, res) => {
  const { rows: [pub] }    = await pool.query("SELECT value FROM app_settings WHERE key='stripe_publishable_key'");
  const { rows: [secret] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  res.json({
    publishable_key: pub?.value || '',
    secret_key_set: !!(secret?.value || process.env.STRIPE_SECRET_KEY),
  });
});

router.post('/stripe', async (req, res) => {
  const { publishable_key, secret_key, webhook_secret } = req.body;
  const upsert = (key, val) => pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [key, val]
  );
  if (publishable_key !== undefined) await upsert('stripe_publishable_key', publishable_key);
  if (secret_key)     await upsert('stripe_secret_key', secret_key);
  if (webhook_secret) await upsert('stripe_webhook_secret', webhook_secret);
  res.json({ ok: true });
});

module.exports = router;
