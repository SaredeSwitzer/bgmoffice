const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireSaredeOnly } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// End-of-shift summaries. Anyone working a shift can send one; only Sarede reads the
// whole set. Whoever wrote one can see their own, so "did that send?" has an answer
// without needing her.

// Sarede's view: everything, newest first.
router.get('/', requireSaredeOnly, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM shift_reports ORDER BY created_at DESC LIMIT 60'
  );
  res.json(rows);
});

router.get('/mine', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM shift_reports WHERE author = $1 ORDER BY created_at DESC LIMIT 10',
    [req.user.initials]
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { steps = [], counts = {}, note } = req.body;
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ error: 'Nothing to send' });
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO shift_reports (author, author_name, steps, counts, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      req.user.initials,
      req.user.name || null,
      JSON.stringify(steps),
      JSON.stringify(counts),
      String(note || '').trim() || null,
    ]
  );
  res.status(201).json(row);
});

// Marked read only when Sarede says so, not on render — otherwise loading the page
// clears the "new" flag on summaries she hasn't actually looked at.
router.patch('/:id/read', requireSaredeOnly, async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE shift_reports SET read_at = now() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

module.exports = router;
