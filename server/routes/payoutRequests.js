const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function requireInstructor(req, res) {
  if (req.user?.role !== 'instructor' || !req.user.instructor_id) {
    res.status(403).json({ error: 'Instructor account required' });
    return false;
  }
  return true;
}

// GET /status?week_start=YYYY-MM-DD — has this instructor already requested this week?
router.get('/status', async (req, res) => {
  if (!requireInstructor(req, res)) return;
  const { week_start } = req.query;
  if (!isDate(week_start)) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) required' });
  const { rows: [row] } = await pool.query(
    'SELECT amount, requested_at FROM payout_requests WHERE instructor_id = $1 AND week_start = $2',
    [req.user.instructor_id, week_start]
  );
  res.json({ requested: !!row, amount: row?.amount ?? null, requested_at: row?.requested_at ?? null });
});

// POST / — record that the instructor clicked "Send Payout Request" (intent, not confirmation).
router.post('/', async (req, res) => {
  if (!requireInstructor(req, res)) return;
  const { week_start, amount } = req.body;
  if (!isDate(week_start)) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) required' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'Valid amount required' });
  await pool.query(
    `INSERT INTO payout_requests (instructor_id, week_start, amount, requested_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (instructor_id, week_start) DO UPDATE SET amount = EXCLUDED.amount, requested_at = now()`,
    [req.user.instructor_id, week_start, amt]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
