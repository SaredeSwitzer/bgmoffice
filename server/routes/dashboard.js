const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CLIENT_FACING_TYPES = [
  'FOLLOW UP WITH CLIENT',
  'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL',
  'FOLLOW UP ON BLAST RESPONSES',
  'ADD TO RECRUITING / SEND BLAST',
];

const INSTRUCTOR_FACING_TYPES = [
  'FOLLOW UP WITH INSTRUCTOR',
  'INSTRUCTOR AWAY - INFORM ALL CLIENTS',
];

const BASE_SQL = `
  SELECT
    ai.id,
    ai.case_id,
    ai.status,
    ai.initial_note,
    ai.created_at,
    ai.starred,
    at.id    AS action_type_id,
    at.name  AS action_type_name,
    at.color AS action_type_color,
    d.id     AS delegate_id,
    d.name   AS delegate_name,
    cl.id    AS client_id,
    cl.name  AS client_name,
    i.id     AS instructor_id,
    i.name   AS instructor_name
  FROM action_items ai
  JOIN action_types at ON at.id = ai.action_type_id
  LEFT JOIN delegates  d  ON d.id  = ai.delegate_id
  LEFT JOIN cases      c  ON c.id  = ai.case_id
  LEFT JOIN clients    cl ON cl.id = c.client_id
  LEFT JOIN instructors i ON i.id  = c.instructor_id
  WHERE ai.status = 'open'
`;

function attachLastNote(items) {
  return items.map(item => {
    const last = db.prepare(
      'SELECT text, author_initials, created_at FROM follow_up_notes WHERE action_item_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(item.id);
    return { ...item, last_note: last || null };
  });
}

function sortItems(items) {
  // PRIORITY pinned first, then starred, then oldest first
  return items.sort((a, b) => {
    const aPriority = a.action_type_name === 'PRIORITY' ? 0 : 1;
    const bPriority = b.action_type_name === 'PRIORITY' ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aStarred = a.starred ? 0 : 1;
    const bStarred = b.starred ? 0 : 1;
    if (aStarred !== bStarred) return aStarred - bStarred;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

router.get('/my-tasks', (req, res) => {
  const firstName = req.user.name.split(' ')[0];
  const delegate = db.prepare('SELECT * FROM delegates WHERE LOWER(name) = LOWER(?) LIMIT 1').get(firstName);
  if (!delegate) return res.json({ tasks: [], delegate_name: null });
  const items = db.prepare(BASE_SQL + ' AND d.id = ? ORDER BY ai.created_at ASC').all(delegate.id);
  return res.json({ tasks: sortItems(attachLastNote(items)), delegate_name: delegate.name });
});

router.get('/', (req, res) => {
  const allOpen = attachLastNote(
    db.prepare(BASE_SQL + ' ORDER BY ai.created_at ASC').all()
  );

  const cp = CLIENT_FACING_TYPES.map(() => '?').join(',');
  const ip = INSTRUCTOR_FACING_TYPES.map(() => '?').join(',');

  res.json({
    open_tasks:           sortItems(allOpen),
    client_followups:     sortItems(attachLastNote(
      db.prepare(BASE_SQL + ` AND at.name IN (${cp}) ORDER BY ai.created_at ASC`).all(...CLIENT_FACING_TYPES)
    )),
    instructor_followups: sortItems(attachLastNote(
      db.prepare(BASE_SQL + ` AND at.name IN (${ip}) ORDER BY ai.created_at ASC`).all(...INSTRUCTOR_FACING_TYPES)
    )),
  });
});

module.exports = router;
