const pool = require('../db/pg');

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
  const { rows: users } = await pool.query('SELECT id, name FROM users WHERE active = 1');
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

module.exports = { findMentionedUserIds, syncMentions, deleteMentions };
