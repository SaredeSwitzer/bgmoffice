const pool = require('../db/pg');

// Mentionable = office staff only (Sarede/Maria/Claire today), not the 70+ instructor
// logins or the generic Admin account — @mentioning an instructor wouldn't reach anyone
// who's actually watching My Tasks. Shown/matched by first name only ("Sarede", not
// "Sarede S") since that's how the office actually refers to each other.
async function getMentionableUsers() {
  const { rows } = await pool.query("SELECT id, name FROM users WHERE active = 1 AND role = 'staff' ORDER BY name");
  return rows.map(u => ({ id: u.id, name: u.name.split(' ')[0] }));
}

// Finds "@Full Name" occurrences in free text against a list of {id, name}. Longest
// names are matched first so "Sarede Switzer" isn't shadowed by a shorter "Sarede".
// Overlapping matches (one name's match range inside another's) are skipped.
function findMentionedUserIds(text, users) {
  if (!text) return [];
  const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
  const found = new Set();
  const consumed = [];
  for (const u of sorted) {
    const needle = `@${u.name}`;
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      const overlaps = consumed.some(([s, e]) => idx < e && idx + needle.length > s);
      if (!overlaps) {
        found.add(u.id);
        consumed.push([idx, idx + needle.length]);
      }
      idx = text.indexOf(needle, idx + 1);
    }
  }
  return [...found];
}

// Replaces every mention row for one note with whatever's currently tagged in its
// text. Called on both create and edit, so editing a note to add/remove a tag keeps
// the mention list in sync. Re-tagging an already-resolved mention surfaces it again
// as unresolved — acceptable, since an edit is a reasonable reason to re-notify.
async function syncMentions({ sourceTable, sourceId, text, authorInitials, linkPath }) {
  const users = await getMentionableUsers();
  const userIds = findMentionedUserIds(text, users);
  await pool.query('DELETE FROM mentions WHERE source_table = $1 AND source_id = $2', [sourceTable, sourceId]);
  if (!userIds.length) return;
  const snippet = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  await Promise.all(userIds.map(uid =>
    pool.query(
      `INSERT INTO mentions (source_table, source_id, mentioned_user_id, author_initials, snippet, link_path)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sourceTable, sourceId, uid, authorInitials, snippet, linkPath || null]
    )
  ));
}

async function deleteMentions(sourceTable, sourceId) {
  await pool.query('DELETE FROM mentions WHERE source_table = $1 AND source_id = $2', [sourceTable, sourceId]);
}

// Removes "@Full Name" tags from text before it reaches a client-facing surface (the
// pay-by-link page, an invoice PDF/email) — the mention itself already did its job
// (notifying someone internally); the client has no reason to see "@Sarede" in their
// own invoice. Same longest-name-first matching as findMentionedUserIds, then collapses
// the leftover double space and trims.
function stripMentions(text, users) {
  if (!text) return text;
  const sorted = [...users].sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const u of sorted) {
    result = result.split(`@${u.name}`).join('');
  }
  return result.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// Convenience wrapper for the common case: look up mentionable users, then strip.
async function stripMentionsForPublic(text) {
  return stripMentions(text, await getMentionableUsers());
}

// Clearing a tag when the thing it was about is finished.
//
// A mention is a request for someone's attention about a particular piece of work. Once
// that work is marked done the request is answered by definition, but the tag stayed on
// My Tasks regardless — so a list meant to show what still needs a person accumulated
// items that didn't, and the ones that did got harder to see among them.
//
// Resolved, not deleted: it moves to "Show read @mentions" with Put back, the same as
// clearing one by hand. Marking something done by mistake shouldn't lose the tag.
const PARENT_NOTES = {
  reminder:      { table: 'reminder_notes',      parent: 'reminder_id' },
  action_item:   { table: 'follow_up_notes',     parent: 'action_item_id' },
  waiting_sheet: { table: 'waiting_sheet_notes', parent: 'row_id' },
  waiting_on:    { table: 'waiting_on_notes',    parent: 'waiting_on_id' },
  recruiting:    { table: 'recruiting_notes',    parent: 'entry_id' },
};

// A mention can also sit on the thing itself rather than on one of its notes.
const DIRECT_SOURCE = {
  standalone_task: 'standalone_tasks',
  action_item:     'action_items',
};

async function resolveMentionsForParent(kind, parentId) {
  if (!parentId) return 0;
  let cleared = 0;

  const src = PARENT_NOTES[kind];
  if (src) {
    const { rowCount } = await pool.query(
      `UPDATE mentions SET resolved_at = now()
        WHERE resolved_at IS NULL AND source_table = $1
          AND source_id IN (SELECT id FROM ${src.table} WHERE ${src.parent} = $2)`,
      [src.table, parentId]
    );
    cleared += rowCount;
  }

  // Replies to a standalone task aren't rows — they're a JSON array on the task, so the
  // ids have to be read out of it rather than selected.
  if (kind === 'standalone_task') {
    const { rows: [task] } = await pool.query('SELECT replies FROM standalone_tasks WHERE id = $1', [parentId]);
    let ids = [];
    try {
      const parsed = JSON.parse(task?.replies || '[]');
      if (Array.isArray(parsed)) ids = parsed.map(r => String(r.id)).filter(Boolean);
    } catch { /* a malformed array is not a reason to fail marking something done */ }
    if (ids.length) {
      const { rowCount } = await pool.query(
        `UPDATE mentions SET resolved_at = now()
          WHERE resolved_at IS NULL AND source_table = 'task_replies'
            AND source_id = ANY($1::bigint[])`,
        [ids]
      );
      cleared += rowCount;
    }
  }

  const direct = DIRECT_SOURCE[kind];
  if (direct) {
    const { rowCount } = await pool.query(
      `UPDATE mentions SET resolved_at = now()
        WHERE resolved_at IS NULL AND source_table = $1 AND source_id = $2`,
      [direct, parentId]
    );
    cleared += rowCount;
  }

  return cleared;
}

module.exports = {
  resolveMentionsForParent,
  getMentionableUsers, findMentionedUserIds, syncMentions, deleteMentions,
  stripMentions, stripMentionsForPublic,
};
