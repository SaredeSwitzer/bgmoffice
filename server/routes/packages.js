const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function enrichPackage(pkg) {
  const sessions = db.prepare(
    'SELECT * FROM package_sessions WHERE package_id = ? ORDER BY session_date ASC, created_at ASC'
  ).all(pkg.id);
  return { ...pkg, sessions };
}

// ── Get all packages for a client ─────────────────────────────────────────────
router.get('/client/:clientId', (req, res) => {
  const rows = db.prepare(`
    SELECT cp.*, i.name AS instructor_name
    FROM client_packages cp
    LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.client_id = ?
    ORDER BY cp.created_at DESC
  `).all(req.params.clientId);
  res.json(rows.map(enrichPackage));
});

// ── Recently completed packages (last 7 days) — for dashboard ─────────────────
router.get('/completed-recent', (req, res) => {
  const rows = db.prepare(`
    SELECT cp.*, cl.name AS client_name, i.name AS instructor_name
    FROM client_packages cp
    LEFT JOIN clients cl ON cl.id = cp.client_id
    LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.status = 'completed'
      AND cp.created_at >= datetime('now', '-7 days')
    ORDER BY cp.created_at DESC
  `).all();
  // Use the most recent session date as the completion date
  const result = rows.map(pkg => {
    const lastSession = db.prepare(
      'SELECT MAX(session_date) AS last_session FROM package_sessions WHERE package_id = ?'
    ).get(pkg.id);
    return { ...pkg, last_session: lastSession?.last_session };
  });
  res.json(result);
});

// ── Create package ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { client_id, instructor_id, total_classes, start_date, notes } = req.body;
  if (!client_id || !total_classes) {
    return res.status(400).json({ error: 'client_id and total_classes required' });
  }
  const result = db.prepare(`
    INSERT INTO client_packages (client_id, instructor_id, total_classes, start_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    client_id,
    instructor_id || null,
    Number(total_classes),
    start_date || null,
    notes || null,
    req.user.initials
  );
  const row = db.prepare(`
    SELECT cp.*, i.name AS instructor_name
    FROM client_packages cp LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(enrichPackage(row));
});

// ── Update package (notes, status, etc.) ──────────────────────────────────────
router.put('/:id', (req, res) => {
  const pkg = db.prepare('SELECT id FROM client_packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const { instructor_id, total_classes, start_date, notes, status } = req.body;
  db.prepare(`
    UPDATE client_packages
    SET instructor_id=?, total_classes=?, start_date=?, notes=?, status=?
    WHERE id=?
  `).run(
    instructor_id || null,
    Number(total_classes),
    start_date || null,
    notes || null,
    status || 'active',
    req.params.id
  );
  const row = db.prepare(`
    SELECT cp.*, i.name AS instructor_name
    FROM client_packages cp LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.id = ?
  `).get(req.params.id);
  res.json(enrichPackage(row));
});

// ── Delete package ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM client_packages WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Package not found' });
  res.json({ success: true });
});

// ── Log a session ──────────────────────────────────────────────────────────────
router.post('/:id/sessions', (req, res) => {
  const pkg = db.prepare('SELECT * FROM client_packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  if (pkg.status === 'completed') {
    return res.status(409).json({ error: 'Package is already completed.' });
  }

  const { session_date, notes } = req.body;
  if (!session_date) return res.status(400).json({ error: 'session_date required' });

  // Insert session and increment counter atomically
  const result = db.transaction(() => {
    const ins = db.prepare(
      'INSERT INTO package_sessions (package_id, session_date, notes, created_by) VALUES (?, ?, ?, ?)'
    ).run(pkg.id, session_date, notes || null, req.user.initials);

    const newUsed = pkg.classes_used + 1;
    const newStatus = newUsed >= pkg.total_classes ? 'completed' : 'active';

    db.prepare(
      'UPDATE client_packages SET classes_used=?, status=? WHERE id=?'
    ).run(newUsed, newStatus, pkg.id);

    return { sessionId: ins.lastInsertRowid, newUsed, newStatus };
  })();

  const updatedPkg = db.prepare(`
    SELECT cp.*, i.name AS instructor_name
    FROM client_packages cp LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.id = ?
  `).get(pkg.id);

  res.status(201).json(enrichPackage(updatedPkg));
});

// ── Delete a session ───────────────────────────────────────────────────────────
router.delete('/:id/sessions/:sessionId', (req, res) => {
  const pkg = db.prepare('SELECT * FROM client_packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });

  const session = db.prepare(
    'SELECT id FROM package_sessions WHERE id = ? AND package_id = ?'
  ).get(req.params.sessionId, req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM package_sessions WHERE id = ?').run(req.params.sessionId);
    const newUsed = Math.max(0, pkg.classes_used - 1);
    // Only revert to active if status was completed (don't un-cancel)
    const newStatus = pkg.status === 'completed' ? 'active' : pkg.status;
    db.prepare('UPDATE client_packages SET classes_used=?, status=? WHERE id=?')
      .run(newUsed, newStatus, pkg.id);
  })();

  const updatedPkg = db.prepare(`
    SELECT cp.*, i.name AS instructor_name
    FROM client_packages cp LEFT JOIN instructors i ON i.id = cp.instructor_id
    WHERE cp.id = ?
  `).get(req.params.id);
  res.json(enrichPackage(updatedPkg));
});

module.exports = router;
