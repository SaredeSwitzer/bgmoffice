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

// Base query — no action_types join; attached separately via junction table
const BASE_SQL = `
  SELECT
    ai.id, ai.case_id, ai.status, ai.initial_note, ai.created_at, ai.starred,
    d.id   AS delegate_id,   d.name  AS delegate_name,
    cl.id  AS client_id,     cl.name AS client_name,
    i.id   AS instructor_id, i.name  AS instructor_name,
    c.title AS case_title
  FROM action_items ai
  LEFT JOIN delegates   d  ON d.id  = ai.delegate_id
  LEFT JOIN cases       c  ON c.id  = ai.case_id
  LEFT JOIN clients     cl ON cl.id = c.client_id
  LEFT JOIN instructors i  ON i.id  = c.instructor_id
  WHERE ai.status = 'open'
`;

// Adds a filter: item must have at least one action type from the given list
function typeFilter(names) {
  const ph = names.map(() => '?').join(',');
  return `
    AND ai.id IN (
      SELECT aiat.action_item_id
      FROM action_item_action_types aiat
      JOIN action_types at ON at.id = aiat.action_type_id
      WHERE at.name IN (${ph})
    )
  `;
}

const ACTION_TYPES_STMT = db.prepare(`
  SELECT at.id, at.name, at.color, at.order_index
  FROM action_item_action_types aiat
  JOIN action_types at ON at.id = aiat.action_type_id
  WHERE aiat.action_item_id = ?
  ORDER BY at.order_index ASC
`);

function attachActionTypes(items) {
  return items.map(item => {
    const action_types = ACTION_TYPES_STMT.all(item.id);
    return {
      ...item,
      action_types,
      // Legacy single-value shim
      action_type_id:    action_types[0]?.id    ?? null,
      action_type_name:  action_types.map(a => a.name).join(', '),
      action_type_color: action_types[0]?.color ?? 'gray',
    };
  });
}

function attachLastNote(items) {
  return items.map(item => {
    const last = db.prepare(
      'SELECT text, author_initials, created_at FROM follow_up_notes WHERE action_item_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(item.id);
    return { ...item, last_note: last || null };
  });
}

function sortItems(items) {
  // Starred pinned first, then oldest-first within each tier
  return items.sort((a, b) => {
    const aS = a.starred ? 0 : 1;
    const bS = b.starred ? 0 : 1;
    if (aS !== bS) return aS - bS;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

function buildSection(extraSql, params) {
  const rows = db.prepare(BASE_SQL + extraSql).all(...params);
  return sortItems(attachLastNote(attachActionTypes(rows)));
}

router.get('/my-tasks', (req, res) => {
  const firstName = req.user.name.split(' ')[0];
  const delegate = db.prepare('SELECT * FROM delegates WHERE LOWER(name) = LOWER(?) LIMIT 1').get(firstName);
  if (!delegate) return res.json({ tasks: [], delegate_name: null });

  const actionItems = db.prepare(BASE_SQL + ' AND d.id = ? ORDER BY ai.created_at ASC').all(delegate.id);
  const processedActionItems = sortItems(attachLastNote(attachActionTypes(actionItems)))
    .map(t => ({ ...t, source: 'action_item' }));

  const standaloneRows = db.prepare(`
    SELECT st.id, st.title, st.status, st.created_at, st.starred,
           st.client_id,     cl.name AS client_name,
           st.instructor_id, i.name  AS instructor_name,
           st.action_type_id, at.name AS action_type_name, at.color AS action_type_color,
           st.recruiting_note_id
    FROM standalone_tasks st
    LEFT JOIN clients     cl ON cl.id = st.client_id
    LEFT JOIN instructors i  ON i.id  = st.instructor_id
    LEFT JOIN action_types at ON at.id = st.action_type_id
    WHERE st.status = 'open' AND LOWER(st.assigned_to) = LOWER(?)
  `).all(delegate.name);

  const standaloneTasks = standaloneRows.map(t => ({
    ...t,
    source: 'standalone_task',
    case_id: null,
    delegate_name: delegate.name,
    action_types: t.action_type_id
      ? [{ id: t.action_type_id, name: t.action_type_name, color: t.action_type_color }]
      : [],
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : 'Task' },
  }));

  return res.json({
    tasks: sortItems([...processedActionItems, ...standaloneTasks]),
    delegate_name: delegate.name,
  });
});

router.get('/', (req, res) => {
  const actionItemTasks = buildSection(' ORDER BY ai.created_at ASC', []);

  const standaloneRows = db.prepare(`
    SELECT st.id, st.title, st.status, st.created_at, st.starred,
           st.client_id,     cl.name AS client_name,
           st.instructor_id, i.name  AS instructor_name,
           st.action_type_id, at.name AS action_type_name, at.color AS action_type_color,
           st.assigned_to, st.recruiting_note_id, st.notes
    FROM standalone_tasks st
    LEFT JOIN clients     cl ON cl.id = st.client_id
    LEFT JOIN instructors i  ON i.id  = st.instructor_id
    LEFT JOIN action_types at ON at.id = st.action_type_id
    WHERE st.status = 'open'
    ORDER BY st.starred DESC, st.created_at ASC
  `).all();

  const standaloneTasks = standaloneRows.map(t => ({
    id: t.id,
    case_id: null,
    status: t.status,
    created_at: t.created_at,
    starred: t.starred,
    delegate_name: t.assigned_to,
    client_id: t.client_id,
    client_name: t.client_name,
    instructor_id: t.instructor_id,
    instructor_name: t.instructor_name,
    case_title: null,
    action_types: t.action_type_id
      ? [{ id: t.action_type_id, name: t.action_type_name, color: t.action_type_color }]
      : [],
    action_type_id: t.action_type_id,
    action_type_name: t.action_type_name || null,
    action_type_color: t.action_type_color || 'gray',
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : 'Task' },
    source: t.recruiting_note_id ? 'recruiting' : 'standalone',
    recruiting_note_id: t.recruiting_note_id,
  }));

  const open_tasks = [...actionItemTasks, ...standaloneTasks]
    .sort((a, b) => (b.starred - a.starred) || (new Date(a.created_at) - new Date(b.created_at)));

  res.json({
    open_tasks,
    client_followups:     buildSection(typeFilter(CLIENT_FACING_TYPES)     + ' ORDER BY ai.created_at ASC', CLIENT_FACING_TYPES),
    instructor_followups: buildSection(typeFilter(INSTRUCTOR_FACING_TYPES) + ' ORDER BY ai.created_at ASC', INSTRUCTOR_FACING_TYPES),
  });
});

module.exports = router;
