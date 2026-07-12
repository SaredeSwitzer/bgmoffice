const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const PKG_JOIN = `
  SELECT cp.*, i.name AS instructor_name
  FROM client_packages cp
  LEFT JOIN instructors i ON i.id = cp.instructor_id
`;

async function enrichPackage(pkg) {
  const { rows: sessions } = await pool.query(
    'SELECT * FROM package_sessions WHERE package_id = $1 ORDER BY session_date ASC, created_at ASC',
    [pkg.id]
  );
  return { ...pkg, sessions };
}

router.get('/client/:clientId', async (req, res) => {
  const { rows } = await pool.query(`${PKG_JOIN} WHERE cp.client_id = $1 ORDER BY cp.created_at DESC`, [req.params.clientId]);
  res.json(await Promise.all(rows.map(enrichPackage)));
});

router.get('/completed-recent', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cp.*, cl.name AS client_name, i.name AS instructor_name
     FROM client_packages cp
     LEFT JOIN clients cl ON cl.id = cp.client_id
     LEFT JOIN instructors i ON i.id = cp.instructor_id
     WHERE cp.status = 'completed'
       AND cp.created_at >= to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD HH24:MI:SS')
     ORDER BY cp.created_at DESC`
  );
  const result = await Promise.all(rows.map(async pkg => {
    const { rows: [last] } = await pool.query(
      'SELECT MAX(session_date) AS last_session FROM package_sessions WHERE package_id = $1',
      [pkg.id]
    );
    return { ...pkg, last_session: last?.last_session };
  }));
  res.json(result);
});

router.post('/', async (req, res) => {
  const { client_id, instructor_id, total_classes, start_date, notes } = req.body;
  if (!client_id || !total_classes) return res.status(400).json({ error: 'client_id and total_classes required' });

  const { rows: [pkg] } = await pool.query(
    'INSERT INTO client_packages (client_id, instructor_id, total_classes, start_date, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [client_id, instructor_id || null, Number(total_classes), start_date || null, notes || null, req.user.initials]
  );
  const { rows: [row] } = await pool.query(`${PKG_JOIN} WHERE cp.id = $1`, [pkg.id]);
  res.status(201).json(await enrichPackage(row));
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM client_packages WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Package not found' });
  const { instructor_id, total_classes, start_date, notes, status } = req.body;
  await pool.query(
    'UPDATE client_packages SET instructor_id=$1, total_classes=$2, start_date=$3, notes=$4, status=$5 WHERE id=$6',
    [instructor_id || null, Number(total_classes), start_date || null, notes || null, status || 'active', req.params.id]
  );
  const { rows: [row] } = await pool.query(`${PKG_JOIN} WHERE cp.id = $1`, [req.params.id]);
  res.json(await enrichPackage(row));
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM client_packages WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Package not found' });
  res.json({ success: true });
});

router.post('/:id/sessions', async (req, res) => {
  const { rows: [pkg] } = await pool.query('SELECT * FROM client_packages WHERE id = $1', [req.params.id]);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  if (pkg.status === 'completed') return res.status(409).json({ error: 'Package is already completed.' });

  const { session_date, notes } = req.body;
  if (!session_date) return res.status(400).json({ error: 'session_date required' });

  await pool.query(
    'INSERT INTO package_sessions (package_id, session_date, notes, created_by) VALUES ($1,$2,$3,$4)',
    [pkg.id, session_date, notes || null, req.user.initials]
  );

  const newUsed   = Number(pkg.classes_used) + 1;
  const newStatus = newUsed >= Number(pkg.total_classes) ? 'completed' : 'active';
  await pool.query('UPDATE client_packages SET classes_used=$1, status=$2 WHERE id=$3', [newUsed, newStatus, pkg.id]);

  const { rows: [row] } = await pool.query(`${PKG_JOIN} WHERE cp.id = $1`, [pkg.id]);
  res.status(201).json(await enrichPackage(row));
});

router.delete('/:id/sessions/:sessionId', async (req, res) => {
  const { rows: [pkg] } = await pool.query('SELECT * FROM client_packages WHERE id = $1', [req.params.id]);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const { rows: [session] } = await pool.query('SELECT id FROM package_sessions WHERE id = $1 AND package_id = $2', [req.params.sessionId, req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  await pool.query('DELETE FROM package_sessions WHERE id = $1', [req.params.sessionId]);
  const newUsed   = Math.max(0, Number(pkg.classes_used) - 1);
  const newStatus = pkg.status === 'completed' ? 'active' : pkg.status;
  await pool.query('UPDATE client_packages SET classes_used=$1, status=$2 WHERE id=$3', [newUsed, newStatus, pkg.id]);

  const { rows: [row] } = await pool.query(`${PKG_JOIN} WHERE cp.id = $1`, [req.params.id]);
  res.json(await enrichPackage(row));
});

module.exports = router;
