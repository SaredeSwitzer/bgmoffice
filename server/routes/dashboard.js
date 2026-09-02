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
// client_notes, invoice_notes, standalone_tasks/task_replies, action_items/
// follow_up_notes, reminder_notes, sales_lead_notes, instructor_notes,
// waiting_sheet_notes). Add a LEFT JOIN here when a new note type (source_table) gains
// @mention support. class_notes/admin_notes have no join — a class note's link lands on
// the schedule, which shows the class itself.
async function loadMentionTasks(userId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.source_table, m.source_id, m.snippet, m.author_initials, m.created_at, m.link_path,
            COALESCE(re.client_name, cl.name, icl.name, stcl.name, aicl.name, fucl.name, rncl.name, slcl.name, sl.name,
                     wsp_client.name) AS client_name,
            COALESCE(stins.name, aiins.name, fuins.name, rnins.name, insn.name, wsp_instr.name) AS instructor_name
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
     -- reminder_notes mentions are keyed by the note's own id — join through to the
     -- reminder itself, which (unlike task_replies/follow_up_notes) already carries its
     -- own client_id/instructor_id directly, no case indirection needed.
     LEFT JOIN reminder_notes      rnn   ON m.source_table = 'reminder_notes' AND rnn.id = m.source_id
     LEFT JOIN reminders           rnr   ON rnr.id = rnn.reminder_id
     LEFT JOIN clients             rncl  ON rncl.id = rnr.client_id
     LEFT JOIN instructors         rnins ON rnins.id = rnr.instructor_id
     -- sales_lead_notes mentions are keyed by the note's own id — join through to the
     -- lead itself; falls back to the lead's own typed-in name when it isn't linked to
     -- a real client record yet.
     LEFT JOIN sales_lead_notes    sln   ON m.source_table = 'sales_lead_notes' AND sln.id = m.source_id
     LEFT JOIN sales_leads         sl    ON sl.id = sln.sales_lead_id
     LEFT JOIN clients             slcl  ON slcl.id = sl.client_id
     -- instructor_notes (feedback notes on a profile) name the instructor directly.
     LEFT JOIN instructor_notes    inn   ON m.source_table = 'instructor_notes' AND inn.id = m.source_id
     LEFT JOIN instructors         insn  ON insn.id = inn.instructor_id
     -- A waiting-sheet note belongs to a line, and a line can carry several names on
     -- each side; the first of each is enough context to know which line is meant.
     LEFT JOIN waiting_sheet_notes wsn   ON m.source_table = 'waiting_sheet_notes' AND wsn.id = m.source_id
     LEFT JOIN LATERAL (SELECT p.name FROM waiting_sheet_people p
                         WHERE p.row_id = wsn.row_id AND p.kind = 'client'
                         ORDER BY p.created_at LIMIT 1) wsp_client ON true
     LEFT JOIN LATERAL (SELECT p.name FROM waiting_sheet_people p
                         WHERE p.row_id = wsn.row_id AND p.kind = 'instructor'
                         ORDER BY p.created_at LIMIT 1) wsp_instr ON true
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
    // Anchors straight to the specific note the mention lives in (not just the page/
    // entity it's on) — every note-rendering page gives its notes a matching
    // id="note-<source_table>-<id>" DOM id (table-namespaced since source ids aren't
    // unique across tables), see client/src/utils/hashHighlight.js.
    link_path: m.link_path ? `${m.link_path}#note-${m.source_table}-${m.source_id}` : null,
    last_note: { text: m.snippet, author_initials: m.author_initials },
  }));
}

// Overdue reminders only — anything whose date has already passed, from anyone's list.
// Reminders due today (and later) live on the Reminders page; putting them here too made
// My Tasks a second copy of that page instead of a list of what's actually late.
// The ones delegated to the signed-in user are flagged is_mine so the UI floats them to
// the top; the rest are still visible so nothing sits unseen because it carries somebody
// else's name.
async function loadReminderTasks(delegateName) {
  // remind_on is stored as TEXT ('YYYY-MM-DD', a SQLite-era leftover — see
  // reminders.js `today()`), so the due-date comparison happens in JS rather than
  // SQL to avoid a text/date operator mismatch.
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.notes, r.remind_on, r.created_at, r.created_by, r.delegate_name,
            r.client_id, c.name AS client_name,
            r.instructor_id, i.name AS instructor_name
       FROM reminders r
       LEFT JOIN clients     c ON c.id = r.client_id
       LEFT JOIN instructors i ON i.id = r.instructor_id
      WHERE r.status = 'pending'
      ORDER BY r.remind_on ASC`
  );
  // Local date, not UTC — toISOString() rolls over at 8pm Eastern, which made
  // this evening's reminders look overdue for the last four hours of every day.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return rows.filter(r => r.remind_on < today).map(r => ({
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
    delegate_name: r.delegate_name || null,
    is_mine: !!delegateName
          && String(r.delegate_name || '').toLowerCase() === String(delegateName).toLowerCase(),
  }));
}

router.get('/my-tasks', async (req, res) => {
  const mentionTasks = await loadMentionTasks(req.user.id);

  const firstName = req.user.name.split(' ')[0];
  const { rows: [delegate] } = await pool.query('SELECT * FROM delegates WHERE LOWER(name) = LOWER($1) LIMIT 1', [firstName]);

  // Reminders aren't scoped to a delegate any more, so they load either way — somebody
  // without a delegate record still sees the whole due list.
  const reminderTasks = await loadReminderTasks(delegate ? delegate.name : null);
  if (!delegate) return res.json({ tasks: sortItems([...mentionTasks, ...reminderTasks]), delegate_name: null });

  const { rows: aiRows } = await pool.query(`${BASE_SQL} AND d.id = $1 ORDER BY ai.created_at ASC`, [delegate.id]);
  const processedAI = sortItems(await attachLastNote(await attachActionTypes(aiRows)))
    .map(t => ({ ...t, source: 'action_item' }));

  // Unassigned action items are the real "up for grabs" pile — nobody's name is on them,
  // so nobody saw them in My Tasks and they quietly aged. Same treatment as a task
  // explicitly assigned to "Anyone": shown to every delegate, flagged so the UI can
  // group them separately.
  const { rows: anyoneAiRows } = await pool.query(
    `${BASE_SQL} AND ai.delegate_id IS NULL ORDER BY ai.created_at ASC`
  );
  const anyoneAI = sortItems(await attachLastNote(await attachActionTypes(anyoneAiRows)))
    .map(t => ({ ...t, source: 'action_item', is_anyone: true, delegate_name: 'Anyone' }));

  const { rows: standaloneRows } = await pool.query(
    `SELECT st.id, st.title, st.status, st.created_at, st.starred, st.assigned_to,
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
     WHERE st.status = 'open'
       AND (LOWER(st.assigned_to) = LOWER($1)
            OR LOWER(COALESCE(st.assigned_to, '')) = 'anyone'
            OR COALESCE(st.assigned_to, '') = '')`,
    [delegate.name]
  );

  const standaloneTasks = standaloneRows.map(t => ({
    ...t,
    source: t.recruiting_note_id ? 'recruiting' : 'standalone',
    case_id: null,
    // Up for grabs means BOTH the explicit "Anyone" option in the assignee dropdown and
    // anything left unassigned — in practice they mean the same thing to whoever's
    // working, and neither was visible to anybody before.
    is_anyone: !String(t.assigned_to || '').trim()
            || String(t.assigned_to).toLowerCase() === 'anyone',
    delegate_name: String(t.assigned_to || '').trim() && String(t.assigned_to).toLowerCase() !== 'anyone'
      ? delegate.name : 'Anyone',
    action_types: t.action_type_id
      ? [{ id: t.action_type_id, name: t.action_type_name, color: t.action_type_color }]
      : [],
    last_note: { text: t.title, author_initials: t.recruiting_note_id ? 'Recruiting' : 'Task' },
    recruiting_entry_id: t.recruiting_entry_id || null,
  }));

  res.json({
    tasks: sortItems([...processedAI, ...anyoneAI, ...standaloneTasks, ...mentionTasks, ...reminderTasks]),
    delegate_name: delegate.name,
  });
});

// Compact name→id directory for clients and instructors. Used client-side to turn a
// phrase like "waiting to hear back from Stephanie" in a note into a link to the right
// person, so it's small on purpose — id, name, kind, nothing else.
router.get('/directory', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, 'client' AS kind FROM clients WHERE COALESCE(TRIM(name),'') <> ''
    UNION ALL
    SELECT id, name, 'instructor' AS kind FROM instructors WHERE COALESCE(TRIM(name),'') <> ''
  `);
  res.json(rows);
});

// Everything needed to read a mention without leaving My Tasks: the full note (the
// stored snippet is truncated at 160 chars), the rest of that conversation, and the
// ids a reply needs to land in the right thread.
//
// The five note tables don't share a shape — the parent column and the author column
// are named differently in each — so this maps them once here rather than making the
// front end know about any of it.
const NOTE_SOURCES = {
  follow_up_notes:  { parent: 'action_item_id',  author: 'author_initials', reply: id => `/api/action-items/${id}/notes` },
  recruiting_notes: { parent: 'entry_id',        author: 'author_initials', reply: id => `/api/recruiting/entries/${id}/notes` },
  reminder_notes:   { parent: 'reminder_id',     author: 'author_initials', reply: id => `/api/reminders/${id}/notes` },
  sales_lead_notes: { parent: 'sales_lead_id',   author: 'author_initials', reply: id => `/api/sales/${id}/notes` },
  instructor_notes: { parent: 'instructor_id',   author: 'author',          reply: id => `/api/instructors/${id}/notes` },
};

router.get('/mentions/:id/thread', async (req, res) => {
  const { rows: [m] } = await pool.query(
    'SELECT * FROM mentions WHERE id = $1 AND mentioned_user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!m) return res.status(404).json({ error: 'Not found' });

  const src = NOTE_SOURCES[m.source_table];
  // A mention on something without a note thread (a task title, say) still opens —
  // it just shows the snippet and offers the link out instead of a reply box.
  if (!src) return res.json({ mention: m, note: null, thread: [], reply_to: null });

  const { rows: [note] } = await pool.query(
    `SELECT id, text, ${src.author} AS author, created_at, ${src.parent} AS parent_id
       FROM ${m.source_table} WHERE id = $1`,
    [m.source_id]
  );
  if (!note) return res.json({ mention: m, note: null, thread: [], reply_to: null });

  // The few notes either side of it, so a one-line "@Sarede thoughts?" has the
  // conversation it belongs to attached instead of arriving with no context.
  const { rows: thread } = await pool.query(
    `SELECT id, text, ${src.author} AS author, created_at
       FROM ${m.source_table} WHERE ${src.parent} = $1
      ORDER BY created_at ASC LIMIT 40`,
    [note.parent_id]
  );

  res.json({
    mention: m,
    note,
    thread,
    reply_to: { path: src.reply(note.parent_id), source_table: m.source_table },
  });
});

router.patch('/mentions/:id/resolve', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE mentions SET resolved_at = now() WHERE id = $1 AND mentioned_user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Opening a mention marks it read, which drops it off My Tasks — so there has to be a way
// back for one opened by accident or left half-dealt-with.
router.patch('/mentions/:id/unresolve', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE mentions SET resolved_at = NULL WHERE id = $1 AND mentioned_user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Open @mentions for someone else on the team.
//
// /my-tasks is scoped to the signed-in user, so a mention tagged to Maria was visible to
// Maria alone — Sarede could tag her and then have no way to tell whether it had landed
// or been dealt with. Staff-only and read-only: it shows what's outstanding, it doesn't
// let one person clear another's list.
router.get('/mentions/open', async (req, res) => {
  const person = String(req.query.person || '').trim();
  if (!person) return res.status(400).json({ error: 'person is required' });
  const { rows } = await pool.query(
    `SELECT m.id, m.source_table, m.source_id, m.snippet, m.author_initials, m.created_at,
            m.link_path, u.name AS person_name
       FROM mentions m
       JOIN users u ON u.id = m.mentioned_user_id
      WHERE m.resolved_at IS NULL
        AND u.role = 'staff'
        AND (LOWER(u.name) = LOWER($1) OR LOWER(split_part(u.name, ' ', 1)) = LOWER($1))
      ORDER BY m.created_at DESC`,
    [person]
  );
  res.json(rows.map(m => ({
    mention_id: m.id,
    person_name: m.person_name,
    snippet: m.snippet,
    author_initials: m.author_initials,
    created_at: m.created_at,
    link_path: m.link_path ? `${m.link_path}#note-${m.source_table}-${m.source_id}` : null,
  })));
});

// Recently-read mentions, newest first — backs the "read @mentions" list on My Tasks.
router.get('/mentions/read', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, source_table, source_id, snippet, author_initials, link_path, resolved_at
       FROM mentions
      WHERE mentioned_user_id = $1 AND resolved_at IS NOT NULL
      ORDER BY resolved_at DESC LIMIT 25`,
    [req.user.id]
  );
  res.json(rows.map(m => ({
    mention_id: m.id,
    snippet: m.snippet,
    author_initials: m.author_initials,
    resolved_at: m.resolved_at,
    link_path: m.link_path ? `${m.link_path}#note-${m.source_table}-${m.source_id}` : null,
  })));
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
