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

// Resolves display context (client name) per source table (recruiting_notes,
// client_notes, invoice_notes). Add a LEFT JOIN here when a new note type
// (source_table) gains @mention support.
async function loadMentionTasks(userId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.snippet, m.author_initials, m.created_at, m.link_path,
            COALESCE(re.client_name, cl.name, icl.name, stcl.name, aicl.name, fucl.name) AS client_name,
            COALESCE(stins.name, aiins.name, fuins.name) AS instructor_name
     FROM mentions m
     LEFT JOIN recruiting_notes    rn    ON m.source_table = 'recruiting_notes' AND rn.id = m.source_id
     LEFT JOIN recruiting_entries  re    ON re.id = rn.entry_id
     LEFT JOIN clients             cl    ON m.source_table = 'client_notes' AND cl.id = m.source_id
     LEFT JOIN invoices            inv   ON m.source_table = 'invoice_notes' AND inv.id = m.source_id
     LEFT JOIN clients             icl   ON icl.id = inv.client_id
     -- task_replies mentions are keyed by the reply's own id, not the task's, so
     -- there's no row here to join back to the task/client — link_path alone
     -- still takes the mentioned person straight to the right task.
     LEFT JOIN standalone_tasks    stt   ON m.source_table = 'standalone_tasks' AND stt.id = m.source_id
     LEFT JOIN clients             stcl  ON stcl.id = stt.client_id
     LEFT JOIN instructors         stins ON stins.id = stt.instructor_id
     LEFT JOIN action_items        ai    ON m.source_table = 'action_items' AND ai.id = m.source_id
     LEFT JOIN cases               aic   ON aic.id = ai.case_id
     LEFT JOIN clients             aicl  ON aicl.id = aic.client_id
     LEFT JOIN instructors         aiins ON aiins.id = aic.instructor_id
     -- follow_up_notes mentions are keyed by the note's own id, same reasoning as
     -- task_replies above — join through to the case for display context.
     LEFT JOIN follow_up_notes     fun   ON m.source_table = 'follow_up_notes' AND fun.id = m.source_id
     LEFT JOIN action_items        fuai  ON fuai.id = fun.action_item_id
     LEFT JOIN cases               fuc   ON fuc.id = fuai.case_id
     LEFT JOIN clients             fucl  ON fucl.id = fuc.client_id
     LEFT JOIN instructors         fuins ON fuins.id = fuc.instructor_id
     WHERE m.mentioned_user_id = $1 AND m.resolved_at IS NULL
     ORDER BY m.created_at DESC`,
    [userId]
  );
  return rows.map(m => ({
    id: `mention-${m.id}`,
    mention_id: m.id,
    source: 'mention',
    categories: ['mention'],
    created_at: m.created_at,
    client_name: m.client_name || null,
    instructor_name: m.instructor_name || null,
    link_path: m.link_path || null,
    last_note: { text: m.snippet, author_initials: m.author_initials },
  }));
}

// Reminders delegated to this person that are due (today or overdue) — anything
// scheduled further out stays on the Reminders page until its date arrives, so My
// Tasks only shows what actually needs doing right now.
async function loadReminderTasks(delegateName) {
  // remind_on is stored as TEXT ('YYYY-MM-DD', a SQLite-era leftover — see
  // reminders.js `today()`), so the due-date comparison happens in JS rather than
  // SQL to avoid a text/date operator mismatch.
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.notes, r.remind_on, r.created_at, r.created_by,
            r.client_id, c.name AS client_name,
            r.instructor_id, i.name AS instructor_name
       FROM reminders r
       LEFT JOIN clients     c ON c.id = r.client_id
       LEFT JOIN instructors i ON i.id = r.instructor_id
      WHERE r.status = 'pending' AND LOWER(r.delegate_name) = LOWER($1)
      ORDER BY r.remind_on ASC`,
    [delegateName]
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter(r => r.remind_on <= today).map(r => ({
    id: r.id,
    source: 'reminder',
    categories: ['reminder'],
    created_at: r.created_at || r.remind_on,
    created_by: r.created_by,
    client_id: r.client_id, client_name: r.client_name,
    instructor_id: r.instructor_id, instructor_name: r.instructor_name,
    last_note: { text: r.notes || r.title, author_initials: 'Reminder' },
    title: r.title,
    remind_on: r.remind_on,
  }));
}

router.get('/my-tasks', async (req, res) => {
  const mentionTasks = await loadMentionTasks(req.user.id);

  const firstName = req.user.name.split(' ')[0];
  const { rows: [delegate] } = await pool.query('SELECT * FROM delegates WHERE LOWER(name) = LOWER($1) LIMIT 1', [firstName]);
  if (!delegate) return res.json({ tasks: sortItems(mentionTasks), delegate_name: null });

  const reminderTasks = await loadReminderTasks(delegate.name);

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
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : 'Task' },
    recruiting_entry_id: t.recruiting_entry_id || null,
  }));

  res.json({ tasks: sortItems([...processedAI, ...standaloneTasks, ...mentionTasks, ...reminderTasks]), delegate_name: delegate.name });
});

router.patch('/mentions/:id/resolve', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE mentions SET resolved_at = now() WHERE id = $1 AND mentioned_user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
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
    // Standalone tasks don't have a Client/Instructor F/U distinction the way action
    // items do — they all land in Other, including ones with no explicit type at all.
    categories: ['other'],
    recruiting_note_id: t.recruiting_note_id,
    recruiting_entry_id: t.recruiting_entry_id || null,
  }));

  const open_tasks = [...actionItemTasks, ...standaloneTasks]
    .sort((a, b) => (b.starred - a.starred) || (new Date(a.created_at) - new Date(b.created_at)));
  res.json({ open_tasks });
});

module.exports = router;
