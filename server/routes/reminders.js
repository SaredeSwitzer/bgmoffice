const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── GET / — { overdue, upcoming } — optional ?client_id or ?instructor_id ────
router.get('/', (req, res) => {
  const { client_id, instructor_id } = req.query;
  const filters = [`r.status = 'pending'`];
  const params  = [];
  if (client_id)     { filters.push('r.client_id = ?');     params.push(client_id); }
  if (instructor_id) { filters.push('r.instructor_id = ?'); params.push(instructor_id); }

  const rows = db.prepare(`
    SELECT
      r.*,
      c.name   AS client_name,
      i.name   AS instructor_name,
      COALESCE(r.case_id, ai.case_id) AS resolved_case_id,
      cl2.name AS case_client_name,
      i2.name  AS case_instructor_name
    FROM reminders r
    LEFT JOIN clients      c   ON c.id   = r.client_id
    LEFT JOIN instructors  i   ON i.id   = r.instructor_id
    LEFT JOIN action_items ai  ON ai.id  = r.action_item_id
    LEFT JOIN cases        cas ON cas.id = COALESCE(r.case_id, ai.case_id)
    LEFT JOIN clients      cl2 ON cl2.id = cas.client_id
    LEFT JOIN instructors  i2  ON i2.id  = cas.instructor_id
    WHERE ${filters.join(' AND ')}
    ORDER BY r.remind_on ASC
  `).all(...params);

  const t = today();
  const hydrate = r => ({ ...r, case_id: r.resolved_case_id });
  res.json({
    overdue:  rows.filter(r => r.remind_on <  t).map(hydrate),
    upcoming: rows.filter(r => r.remind_on >= t).map(hydrate),
  });
});

// ── POST / — create ───────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    title, notes, remind_on,
    client_id, instructor_id, case_id, action_item_id,
    delegate_name,
  } = req.body;

  if (!title || !remind_on)
    return res.status(400).json({ error: 'title and remind_on are required' });

  const result = db.prepare(`
    INSERT INTO reminders
      (title, notes, remind_on, client_id, instructor_id, case_id, action_item_id, delegate_name, created_by)
    VALUES
      (@title, @notes, @remind_on, @client_id, @instructor_id, @case_id, @action_item_id, @delegate_name, @created_by)
  `).run({
    title,
    notes:          notes          || null,
    remind_on,
    client_id:      client_id      || null,
    instructor_id:  instructor_id  || null,
    case_id:        case_id        || null,
    action_item_id: action_item_id || null,
    delegate_name:  delegate_name  || null,
    created_by:     req.user.initials,
  });

  res.status(201).json(
    db.prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid)
  );
});

// Helper: fetch a reminder with joined client/instructor names
function getReminderFull(id) {
  return db.prepare(`
    SELECT r.*,
      c.name  AS client_name,
      i.name  AS instructor_name,
      cl2.name AS case_client_name,
      i2.name  AS case_instructor_name,
      COALESCE(r.case_id, ai.case_id) AS resolved_case_id
    FROM reminders r
    LEFT JOIN clients      c   ON c.id   = r.client_id
    LEFT JOIN instructors  i   ON i.id   = r.instructor_id
    LEFT JOIN action_items ai  ON ai.id  = r.action_item_id
    LEFT JOIN cases        cas ON cas.id = COALESCE(r.case_id, ai.case_id)
    LEFT JOIN clients      cl2 ON cl2.id = cas.client_id
    LEFT JOIN instructors  i2  ON i2.id  = cas.instructor_id
    WHERE r.id = ?
  `).get(id);
}

// ── PUT /:id — edit title, notes, date, delegate, client, instructor ──────────
router.put('/:id', (req, res) => {
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  if (reminder.created_by !== req.user.initials && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  const { title, notes, remind_on, delegate_name, client_id, instructor_id } = req.body;
  if (!title?.trim() || !remind_on)
    return res.status(400).json({ error: 'title and remind_on required' });

  db.prepare(`
    UPDATE reminders
    SET title=?, notes=?, remind_on=?, delegate_name=?, client_id=?, instructor_id=?,
        updated_at=datetime('now')
    WHERE id=?
  `).run(
    title.trim(), notes || null, remind_on, delegate_name || null,
    client_id || null, instructor_id || null,
    req.params.id
  );

  const updated = getReminderFull(req.params.id);
  res.json({ ...updated, case_id: updated.resolved_case_id });
});

// ── PATCH /:id/done ───────────────────────────────────────────────────────────
router.patch('/:id/done', (req, res) => {
  db.prepare(`UPDATE reminders SET status = 'done' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
