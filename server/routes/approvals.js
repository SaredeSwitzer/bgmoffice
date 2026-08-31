const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Options an instructor typed in themselves — a class style on the sign-up form, a
// neighbourhood on their profile. They go live immediately (the picker has to offer
// what someone just told us they teach), so this queue isn't a gate: it's the tidy-up
// pass afterwards. Approving usually means fixing the capitalisation — "prospect
// heights" becomes "Prospect Heights" everywhere it's already been used.

// instructors.styles_taught is a comma-separated copy of style NAMES, not a foreign
// key, so renaming the master row leaves every instructor's copy on the old spelling.
// Same problem, same fix as recruiting.js's propagateStyleRename — kept here as its
// own copy rather than exported across routers, since this one also has to handle
// neighborhoods, which live in a different column.
async function propagateRename(kind, oldName, newName) {
  const column = kind === 'class_style' ? 'styles_taught' : 'neighborhood';
  const { rows } = await pool.query(
    `SELECT id, ${column} AS val FROM instructors WHERE ${column} ILIKE $1`,
    [`%${oldName}%`]
  );
  for (const row of rows) {
    const parts = String(row.val || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.some(n => n.toLowerCase() === oldName.toLowerCase())) continue;
    const updated = [...new Set(
      parts.map(n => (n.toLowerCase() === oldName.toLowerCase() ? newName : n)).filter(Boolean)
    )];
    await pool.query(
      `UPDATE instructors SET ${column} = $1 WHERE id = $2`,
      [updated.join(', ') || null, row.id]
    );
  }
}

const TABLE = { class_style: 'class_styles', neighborhood: 'neighborhoods' };

// Everything still waiting on a decision, newest last so the oldest is dealt with first.
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM option_approvals WHERE status = 'pending' ORDER BY created_at ASC`
  );
  res.json(rows);
});

// Recently decided, for the "what did I just approve?" look-back.
router.get('/decided', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM option_approvals WHERE status <> 'pending'
      ORDER BY decided_at DESC NULLS LAST LIMIT 50`
  );
  res.json(rows);
});

// Approve, optionally under a corrected name. The rename is the point of the screen:
// the corrected spelling replaces the old one in the master list AND on every
// instructor who already picked it, so there's no lingering "prospect heights".
router.patch('/:id/approve', async (req, res) => {
  const { rows: [row] } = await pool.query('SELECT * FROM option_approvals WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Already decided' });

  const table = TABLE[row.kind];
  if (!table) return res.status(400).json({ error: 'Unknown option type' });

  const name = String(req.body.name ?? row.submitted_name).trim();
  if (!name) return res.status(400).json({ error: 'Name required' });

  // Approving into a name that already exists is a merge, not a rename — point
  // everyone at the existing row and drop the duplicate, or the list ends up with
  // "Prospect Heights" twice.
  const { rows: [clash] } = await pool.query(
    `SELECT id, name FROM ${table} WHERE LOWER(name) = LOWER($1) AND id <> $2`,
    [name, row.target_id || 0]
  );

  if (clash) {
    await propagateRename(row.kind, row.submitted_name, clash.name);
    if (row.target_id) await pool.query(`DELETE FROM ${table} WHERE id = $1`, [row.target_id]);
  } else if (row.target_id) {
    await pool.query(`UPDATE ${table} SET name = $1 WHERE id = $2`, [name, row.target_id]);
    if (name !== row.submitted_name) await propagateRename(row.kind, row.submitted_name, name);
  }

  if (row.kind === 'neighborhood' && req.body.region && row.target_id && !clash) {
    await pool.query('UPDATE neighborhoods SET region = $1 WHERE id = $2', [req.body.region, row.target_id]);
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE option_approvals
        SET status = 'approved', final_name = $1, decided_at = now(), decided_by = $2
      WHERE id = $3 RETURNING *`,
    [clash ? clash.name : name, req.user.initials || req.user.name, req.params.id]
  );
  res.json({ ...updated, merged_into: clash ? clash.name : null });
});

// Reject — the option shouldn't exist at all (a typo, a duplicate, something that
// isn't a real style). Removes it from the master list and strips it off anyone who
// already had it, which is the only way it actually disappears.
router.patch('/:id/reject', async (req, res) => {
  const { rows: [row] } = await pool.query('SELECT * FROM option_approvals WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Already decided' });

  const table = TABLE[row.kind];
  if (table && row.target_id) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [row.target_id]);
    await propagateRename(row.kind, row.submitted_name, null);
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE option_approvals
        SET status = 'rejected', decided_at = now(), decided_by = $1
      WHERE id = $2 RETURNING *`,
    [req.user.initials || req.user.name, req.params.id]
  );
  res.json(updated);
});

module.exports = router;
