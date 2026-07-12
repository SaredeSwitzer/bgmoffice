const express = require('express');
const pool    = require('../db/pg');
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
  SELECT ai.id, ai.case_id, ai.status, ai.initial_note, ai.created_at, ai.starred,
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

async function attachActionTypes(items) {
  if (!items.length) return items;
  return Promise.all(items.map(async item => {
    const { rows: action_types } = await pool.query(
      `SELECT at.id, at.name, at.color, at.order_index
       FROM action_item_action_types aiat
       JOIN action_types at ON at.id = aiat.action_type_id
       WHERE aiat.action_item_id = $1
       ORDER BY at.order_index ASC`,
      [item.id]
    );
    return {
      ...item,
      action_types,
      action_type_id:    action_types[0]?.id    ?? null,
      action_type_name:  action_types.map(a => a.name).join(', '),
      action_type_color: action_types[0]?.color ?? 'gray',
    };
  }));
}

async function attachLastNote(items) {
  return Promise.all(items.map(async item => {
    const { rows: [last] } = await pool.query(
      'SELECT text, author_initials, created_at FROM follow_up_notes WHERE action_item_id = $1 ORDER BY created_at DESC LIMIT 1',
      [item.id]
    );
    return { ...item, last_note: last || null };
  }));
}

function sortItems(items) {
  return items.sort((a, b) => {
    const aS = a.starred ? 0 : 1;
    const bS = b.starred ? 0 : 1;
    if (aS !== bS) return aS - bS;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

function attachCategories(items) {
  return items.map(item => {
    const typeNames = (item.action_types || []).map(at => at.name);
    const categories = [];
    if (typeNames.some(n => CLIENT_FACING_TYPES.includes(n)))     categories.push('client_followup');
    if (typeNames.some(n => INSTRUCTOR_FACING_TYPES.includes(n))) categories.push('instructor_followup');
    if (!categories.length) categories.push('other');
    return { ...item, source: 'action_item', categories };
  });
}

router.get('/my-tasks', async (req, res) => {
  const firstName = req.user.name.split(' ')[0];
  const { rows: [delegate] } = await pool.query('SELECT * FROM delegates WHERE LOWER(name) = LOWER($1) LIMIT 1', [firstName]);
  if (!delegate) return res.json({ tasks: [], delegate_name: null });

  const { rows: aiRows } = await pool.query(`${BASE_SQL} AND d.id = $1 ORDER BY ai.created_at ASC`, [delegate.id]);
  const processedAI = sortItems(await attachLastNote(await attachActionTypes(aiRows)))
    .map(t => ({ ...t, source: 'action_item' }));

  const { rows: standaloneRows } = await pool.query(
    `SELECT st.id, st.title, st.status, st.created_at, st.starred,
            st.client_id, cl.name AS client_name,
            st.instructor_id, i.name AS instructor_name,
            st.action_type_id, at.name AS action_type_name, at.color AS action_type_color,
            st.recruiting_note_id, st.task_type,
            rn.entry_id AS recruiting_entry_id
     FROM standalone_tasks st
     LEFT JOIN clients          cl ON cl.id = st.client_id
     LEFT JOIN instructors       i ON i.id  = st.instructor_id
     LEFT JOIN action_types     at ON at.id = st.action_type_id
     LEFT JOIN recruiting_notes rn ON rn.id = st.recruiting_note_id
     WHERE st.status = 'open' AND LOWER(st.assigned_to) = LOWER($1)`,
    [delegate.name]
  );

  const standaloneTasks = standaloneRows.map(t => ({
    ...t,
    source: t.recruiting_note_id ? 'recruiting' : 'standalone',
    case_id: null,
    delegate_name: delegate.name,
    action_types: t.action_type_id
      ? [{ id: t.action_type_id, name: t.action_type_name, color: t.action_type_color }]
      : [],
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : (t.task_type === 'reference' ? 'Reference' : 'Task') },
    recruiting_entry_id: t.recruiting_entry_id || null,
  }));

  res.json({ tasks: sortItems([...processedAI, ...standaloneTasks]), delegate_name: delegate.name });
});

router.get('/', async (req, res) => {
  const { rows: aiRows } = await pool.query(`${BASE_SQL} ORDER BY ai.created_at ASC`);
  const actionItemTasks = sortItems(
    attachCategories(await attachLastNote(await attachActionTypes(aiRows)))
  );

  const { rows: standaloneRows } = await pool.query(
    `SELECT st.id, st.title, st.status, st.created_at, st.starred,
            st.client_id, cl.name AS client_name,
            st.instructor_id, i.name AS instructor_name,
            st.action_type_id, at.name AS action_type_name, at.color AS action_type_color,
            st.assigned_to, st.recruiting_note_id, st.notes, st.task_type,
            rn.entry_id AS recruiting_entry_id
     FROM standalone_tasks st
     LEFT JOIN clients        cl ON cl.id = st.client_id
     LEFT JOIN instructors    i  ON i.id  = st.instructor_id
     LEFT JOIN action_types   at ON at.id = st.action_type_id
     LEFT JOIN recruiting_notes rn ON rn.id = st.recruiting_note_id
     WHERE st.status = 'open'
     ORDER BY st.starred DESC, st.created_at ASC`
  );

  const standaloneTasks = standaloneRows.map(t => ({
    id: t.id, case_id: null, status: t.status, created_at: t.created_at, starred: t.starred,
    title: t.title, delegate_name: t.assigned_to,
    client_id: t.client_id, client_name: t.client_name,
    instructor_id: t.instructor_id, instructor_name: t.instructor_name,
    case_title: null,
    action_types: t.action_type_id ? [{ id: t.action_type_id, name: t.action_type_name, color: t.action_type_color }] : [],
    action_type_id: t.action_type_id,
    action_type_name: t.action_type_name || null,
    action_type_color: t.action_type_color || 'gray',
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : 'Task' },
    source: t.recruiting_note_id ? 'recruiting' : 'standalone',
    categories: t.recruiting_note_id ? ['recruiting'] : [t.task_type || 'task'],
    recruiting_note_id: t.recruiting_note_id,
    recruiting_entry_id: t.recruiting_entry_id || null,
  }));

  const open_tasks = [...actionItemTasks, ...standaloneTasks]
    .sort((a, b) => (b.starred - a.starred) || (new Date(a.created_at) - new Date(b.created_at)));
  res.json({ open_tasks });
});

module.exports = router;
