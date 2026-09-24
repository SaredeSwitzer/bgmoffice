const express = require('express');
const pool    = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');

// Zoom meetings with instructors and candidates — the schedule, a Join button, and what
// was said. Every Invite to Meeting that goes out lands here on its own; anything else can
// be added by hand. Notes stay on the meeting (with who wrote them and when) and show on
// the instructor's profile; finishing one also ticks their "Interviewed" box.
const router = express.Router();
router.use(requireAuth, requireStaff);

// A candidate who later becomes an instructor is matched by email, so a meeting booked
// before they were in the app still shows on their profile.
// meeting_date comes back as plain 'YYYY-MM-DD' text: the pg driver would otherwise turn
// a DATE into a midnight timestamp, which shows a day early once it crosses timezones.
const SELECT = `
  SELECT m.id, m.name, m.email, m.phone, to_char(m.meeting_date, 'YYYY-MM-DD') AS meeting_date,
         m.meeting_time, m.instructor_id, m.status, m.notes, m.notes_by, m.notes_at,
         m.invite_sent_at, m.created_by, m.created_at, m.updated_at,
         COALESCE(m.instructor_id, (
           SELECT i.id FROM instructors i
            WHERE m.email IS NOT NULL AND lower(trim(i.email)) = lower(trim(m.email))
            ORDER BY i.id DESC LIMIT 1)) AS linked_instructor_id
    FROM zoom_meetings m`;

async function withNames(rows) {
  const ids = [...new Set(rows.map(r => r.linked_instructor_id).filter(Boolean))];
  if (!ids.length) return rows.map(r => ({ ...r, instructor_name: null }));
  const { rows: ins } = await pool.query('SELECT id, name FROM instructors WHERE id = ANY($1)', [ids]);
  const byId = Object.fromEntries(ins.map(i => [String(i.id), i.name]));
  return rows.map(r => ({ ...r, instructor_name: byId[String(r.linked_instructor_id)] || null }));
}

async function getOne(id) {
  const { rows } = await pool.query(`${SELECT} WHERE m.id = $1`, [id]);
  return (await withNames(rows))[0] || null;
}

// The room itself — the same link the invite emails send.
router.get('/link', async (req, res) => {
  const { rows: [r] } = await pool.query("SELECT value FROM app_settings WHERE key = 'meeting_link'");
  res.json({ link: r?.value || null });
});

router.get('/', async (req, res) => {
  const { instructor_id } = req.query;
  let rows;
  if (instructor_id) {
    ({ rows } = await pool.query(
      `SELECT * FROM (${SELECT}) x WHERE x.linked_instructor_id = $1
        ORDER BY meeting_date DESC NULLS LAST, created_at DESC`, [instructor_id]));
  } else {
    ({ rows } = await pool.query(
      `${SELECT} ORDER BY m.meeting_date DESC NULLS LAST, m.created_at DESC LIMIT 300`));
  }
  res.json(await withNames(rows));
});

router.post('/', async (req, res) => {
  const { name, email, phone, meeting_date, meeting_time, instructor_id, notes } = req.body;
  if (!name?.trim() && !email?.trim()) return res.status(400).json({ error: 'Who is the meeting with?' });
  const { rows: [m] } = await pool.query(
    `INSERT INTO zoom_meetings (name, email, phone, meeting_date, meeting_time, instructor_id,
        notes, notes_by, notes_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [name?.trim() || null, email?.trim() || null, phone?.trim() || null, meeting_date || null,
     meeting_time?.trim() || null, instructor_id || null,
     notes?.trim() || null, notes?.trim() ? req.user.initials : null, notes?.trim() ? new Date() : null,
     req.user.initials]
  );
  res.json(await getOne(m.id));
});

// Only the fields sent are changed — an edit to the notes must not blank the date.
const EDITABLE = ['name', 'email', 'phone', 'meeting_date', 'meeting_time', 'instructor_id', 'status', 'notes'];
router.patch('/:id', async (req, res) => {
  const sets = [], vals = [];
  for (const k of EDITABLE) {
    if (req.body[k] === undefined) continue;
    let v = req.body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (k === 'status' && !['scheduled', 'done', 'no_show', 'cancelled'].includes(v)) {
      return res.status(400).json({ error: 'Unknown status' });
    }
    vals.push(v); sets.push(`${k} = $${vals.length}`);
    if (k === 'notes') {
      vals.push(req.user.initials); sets.push(`notes_by = $${vals.length}`);
      sets.push('notes_at = now()');
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change' });
  vals.push(req.params.id);
  const { rowCount } = await pool.query(
    `UPDATE zoom_meetings SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });

  const m = await getOne(req.params.id);
  // Held and linked to an instructor: their profile's "Interviewed" box follows, dated to
  // the meeting. Only fills what's empty — never rewrites an interview already recorded.
  if (m.status === 'done' && m.linked_instructor_id) {
    await pool.query(
      `UPDATE instructors SET interview_done = true,
              interview_date = COALESCE(interview_date, $1),
              interview_by   = COALESCE(interview_by, $2)
        WHERE id = $3`,
      [m.meeting_date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()),
       req.user.initials, m.linked_instructor_id]
    ).catch(e => console.error('[zoom] could not mark interviewed:', e.message));
  }
  res.json(m);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM zoom_meetings WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Called by the invite send so every invite is on the schedule without retyping it.
async function recordInvite({ name, email, phone, date, time, instructor_id, by }) {
  await pool.query(
    `INSERT INTO zoom_meetings (name, email, phone, meeting_date, meeting_time, instructor_id,
        invite_sent_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7)`,
    [name || null, email || null, phone || null, date || null, time || null, instructor_id || null, by || null]
  );
}

module.exports = router;
module.exports.recordInvite = recordInvite;
