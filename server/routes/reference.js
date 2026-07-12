const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM reference_sections ORDER BY display_order ASC, id ASC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { title, content, display_order } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  const { rows: [max] } = await pool.query('SELECT COALESCE(MAX(display_order), 0) AS m FROM reference_sections');
  const { rows: [section] } = await pool.query(
    `INSERT INTO reference_sections (title, content, display_order, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [title.trim(), content ?? '', display_order ?? (max.m + 1), req.user.name]
  );
  res.status(201).json(section);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM reference_sections WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Section not found' });

  const { title, content, display_order } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });

  const { rows: [section] } = await pool.query(
    `UPDATE reference_sections
     SET title=$1, content=$2, display_order=$3, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS')
     WHERE id=$4 RETURNING *`,
    [title.trim(), content ?? '', display_order ?? 0, req.params.id]
  );
  res.json(section);
});

router.patch('/reorder', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  await Promise.all(items.map(({ id, display_order }) =>
    pool.query('UPDATE reference_sections SET display_order=$1 WHERE id=$2', [display_order, id])
  ));
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM reference_sections WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Section not found' });
  res.json({ success: true });
});

module.exports = router;
