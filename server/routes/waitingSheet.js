const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// The working sheet an admin keeps through a shift, and the handoff they leave at the end.
//
// A row is one thread of work rather than one person: "getting Sharon to teach Etty's
// group" is a single row with an instructor and a client on it, and at any moment the ball
// is with one of them. A row can just as well have only an instructor, only a client, or
// several of either — which is why the people sit in their own table.
//
// There is one sheet, shared. Handing over a shift isn't a transfer: the next person opens
// the same live sheet and sees every note. The handoff is written from it.

const ROW_SQL = `
  SELECT r.*,
    COALESCE(
      (SELECT json_agg(json_build_object(
                'id', p.id, 'kind', p.kind, 'person_id', p.person_id, 'name', p.name,
                'waiting', p.waiting)
              ORDER BY p.created_at)
         FROM waiting_sheet_people p WHERE p.row_id = r.id),
      '[]'::json
    ) AS people,
    COALESCE(
      (SELECT json_agg(json_build_object(
                'id', n.id, 'text', n.text, 'author', n.author, 'created_at', n.created_at)
              ORDER BY n.created_at)
         FROM waiting_sheet_notes n WHERE n.row_id = r.id),
      '[]'::json
    ) AS notes
  FROM waiting_sheet_rows r
`;

async function getRow(id) {
  const { rows: [row] } = await pool.query(`${ROW_SQL} WHERE r.id = $1`, [id]);
  return row || null;
}

// Put the hourglass on a person if nobody on the row has it yet. Used when a row is created
// and when a name is added to a row nobody's flagged on, so the common case (one name, we're
// waiting on them) needs no extra click.
async function flagIfFirst(rowId, person) {
  const { rows: [any] } = await pool.query(
    'SELECT 1 FROM waiting_sheet_people WHERE row_id = $1 AND waiting LIMIT 1', [rowId]
  );
  if (any) return;
  await pool.query('UPDATE waiting_sheet_people SET waiting = true WHERE id = $1', [person.id]);
  await pool.query('UPDATE waiting_sheet_rows SET updated_at = now() WHERE id = $1', [rowId]);
}

// Open rows, urgent first, then oldest — the order you'd work them in.
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE r.status = 'open'
      ORDER BY r.urgent DESC,
               (r.need_by IS NOT NULL AND r.need_by < CURRENT_DATE) DESC,
               r.need_by ASC NULLS LAST,
               r.created_at ASC`
  );
  res.json(rows);
});

// The rows that mention one particular person, for their own profile page. Same sheet,
// filtered — a client's page and My Tasks can't disagree, because there's only one list.
router.get('/for/:kind/:personId', async (req, res) => {
  const kind = req.params.kind === 'instructor' ? 'instructor' : 'client';
  const { rows } = await pool.query(
    `${ROW_SQL}
      WHERE r.status = 'open'
        AND EXISTS (
          SELECT 1 FROM waiting_sheet_people p
           WHERE p.row_id = r.id AND p.kind = $1 AND p.person_id = $2
        )
      ORDER BY r.urgent DESC,
               (r.need_by IS NOT NULL AND r.need_by < CURRENT_DATE) DESC,
               r.need_by ASC NULLS LAST,
               r.created_at ASC`,
    [kind, req.params.personId]
  );
  res.json(rows);
});

// Recently cleared, so "what did I just finish?" has an answer.
router.get('/done', async (req, res) => {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE r.status = 'done' ORDER BY r.resolved_at DESC NULLS LAST LIMIT 40`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { what, people = [], urgent = false, need_by = null } = req.body;
  if (!what?.trim()) return res.status(400).json({ error: 'Say what you\'re waiting for' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO waiting_sheet_rows (what, urgent, need_by, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [what.trim(), !!urgent, need_by || null, req.user.initials]
  );
  // The first name on a new line is who we're waiting on — that's why the line exists.
  // It starts flagged so nobody has to remember the extra click; clicking them clears it.
  for (const p of people) {
    if (!p?.name?.trim()) continue;
    const { rows: [added] } = await pool.query(
      `INSERT INTO waiting_sheet_people (row_id, kind, person_id, name) VALUES ($1,$2,$3,$4)
       RETURNING id, kind`,
      [row.id, p.kind === 'instructor' ? 'instructor' : 'client', p.person_id || null, p.name.trim()]
    );
    await flagIfFirst(row.id, added);
  }
  res.status(201).json(await getRow(row.id));
});

router.put('/:id', async (req, res) => {
  const { what, urgent } = req.body;
  if (!what?.trim()) return res.status(400).json({ error: 'Say what you\'re waiting for' });
  const { rows: [row] } = await pool.query(
    `UPDATE waiting_sheet_rows SET what = $1, urgent = COALESCE($2, urgent), updated_at = now()
      WHERE id = $3 RETURNING id`,
    [what.trim(), urgent === undefined ? null : !!urgent, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(await getRow(req.params.id));
});

// Its own endpoint rather than a field on the full save, so a star can never blank
// something the caller didn't send.
router.patch('/:id/urgent', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE waiting_sheet_rows SET urgent = $1, updated_at = now() WHERE id = $2 RETURNING id',
    [!!req.body.urgent, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(await getRow(req.params.id));
});

// "We're waiting on this one now." Clicking the person who already holds it clears it,
// which is how you say the ball is back with us.
router.patch('/:id/need-by', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'UPDATE waiting_sheet_rows SET need_by = $1, updated_at = now() WHERE id = $2 RETURNING id',
    [req.body.need_by || null, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(await getRow(req.params.id));
});

// The flag lives on each person, not on the row, so a line can be waiting on the instructor
// for one thing and the client for another at the same time.
router.patch('/:id/people/:personId/waiting', async (req, res) => {
  const { rows: [p] } = await pool.query(
    'UPDATE waiting_sheet_people SET waiting = $1 WHERE id = $2 AND row_id = $3 RETURNING id',
    [!!req.body.waiting, req.params.personId, req.params.id]
  );
  if (!p) return res.status(404).json({ error: 'That person is not on this row' });
  await pool.query('UPDATE waiting_sheet_rows SET updated_at = now() WHERE id = $1', [req.params.id]);
  res.json(await getRow(req.params.id));
});

router.post('/:id/people', async (req, res) => {
  const { kind, person_id, name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pick or type a name' });
  const { rows: [added] } = await pool.query(
    `INSERT INTO waiting_sheet_people (row_id, kind, person_id, name) VALUES ($1,$2,$3,$4)
     RETURNING id, kind`,
    [req.params.id, kind === 'instructor' ? 'instructor' : 'client', person_id || null, name.trim()]
  );
  await flagIfFirst(req.params.id, added);
  res.status(201).json(await getRow(req.params.id));
});

router.delete('/:id/people/:personId', async (req, res) => {
  // The flag goes with them — it lived on their chip.
  await pool.query('DELETE FROM waiting_sheet_people WHERE id = $1 AND row_id = $2',
    [req.params.personId, req.params.id]);
  res.json(await getRow(req.params.id));
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Write something first' });
  await pool.query(
    'INSERT INTO waiting_sheet_notes (row_id, text, author) VALUES ($1,$2,$3)',
    [req.params.id, text.trim(), req.user.initials]
  );
  // Touched so a row someone is actively working doesn't look stale.
  await pool.query('UPDATE waiting_sheet_rows SET updated_at = now() WHERE id = $1', [req.params.id]);
  res.status(201).json(await getRow(req.params.id));
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  await pool.query('DELETE FROM waiting_sheet_notes WHERE id = $1 AND row_id = $2',
    [req.params.noteId, req.params.id]);
  res.json(await getRow(req.params.id));
});

router.patch('/:id/done', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE waiting_sheet_rows SET status = 'done', resolved_by = $1, resolved_at = now(), updated_at = now()
      WHERE id = $2 RETURNING id`,
    [req.user.initials, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.patch('/:id/reopen', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE waiting_sheet_rows SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(await getRow(req.params.id));
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM waiting_sheet_rows WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ── Handoffs ──────────────────────────────────────────────────────────────────

// The one THIS person should read: the most recent handoff addressed to them, or left
// for whoever's next. A handoff addressed to somebody else isn't yours and doesn't
// appear — the app has no idea who's on shift, so it can only go on what was chosen.
//
// Not marked read automatically; that happens when they say so, so it can't be cleared
// by an accidental page load.
router.get('/handoff/latest', async (req, res) => {
  const firstName = String(req.user.name || '').split(' ')[0];
  const { rows: [row] } = await pool.query(
    `SELECT * FROM shift_handoffs
      WHERE handed_to IS NULL OR LOWER(handed_to) = LOWER($1)
      ORDER BY created_at DESC LIMIT 1`,
    [firstName]
  );
  res.json(row || null);
});

// The last handoff this person wrote, so they can still change who it went to after
// saving it — the commonest correction there is.
router.get('/handoff/mine', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM shift_handoffs WHERE author = $1 ORDER BY created_at DESC LIMIT 1',
    [req.user.initials]
  );
  res.json(row || null);
});

router.patch('/handoff/:id/handed-to', async (req, res) => {
  const handedTo = String(req.body.handed_to || '').trim() || null;
  const { rows: [row] } = await pool.query(
    'UPDATE shift_handoffs SET handed_to = $1 WHERE id = $2 RETURNING *',
    [handedTo, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/handoff/history', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM shift_handoffs ORDER BY created_at DESC LIMIT 20'
  );
  res.json(rows);
});

// A starting draft built from the sheet as it stands, so nobody retypes what's already
// there. The three sections match how staff describe a shift: what's on fire, who needs
// chasing, and who owes us a reply.
router.get('/handoff/draft', async (req, res) => {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE r.status = 'open' ORDER BY r.urgent DESC, r.created_at ASC`
  );
  const label = row => {
    const names = (row.people || []).map(p => p.name);
    return names.length ? `${names.join(' / ')} — ${row.what}` : row.what;
  };
  // The most recent note is the part that actually transfers — "VM full, try her
  // husband" tells the next person what to do differently.
  const lastNote = row => {
    const notes = row.notes || [];
    return notes.length ? ` — ${notes[notes.length - 1].text}` : '';
  };
  const flagged = row => (row.people || []).filter(p => p.waiting);
  const waitingLabel = row => {
    const who = flagged(row).map(p => p.name);
    return (who.length ? `${who.join(' & ')} — ${row.what}` : label(row)) + lastNote(row);
  };

  res.json({
    urgent:    rows.filter(r => r.urgent).map(r => label(r) + lastNote(r)).join('\n'),
    // Names only on purpose: the detail lives in the app, and a handoff that restates it
    // goes stale the moment someone updates the record.
    follow_up: rows.filter(r => !r.urgent && !flagged(r).length).map(label).join('\n'),
    waiting:   rows.filter(r => !r.urgent && flagged(r).length).map(waitingLabel).join('\n'),
  });
});

router.post('/handoff', async (req, res) => {
  const { urgent, follow_up, waiting, notes, handed_to } = req.body;
  const { rows: [row] } = await pool.query(
    `INSERT INTO shift_handoffs (author, urgent, follow_up, waiting, notes, handed_to)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.initials, urgent || null, follow_up || null, waiting || null, notes || null,
     String(handed_to || '').trim() || null]
  );
  res.status(201).json(row);
});

router.patch('/handoff/:id/read', async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE shift_handoffs SET read_by = $1, read_at = now() WHERE id = $2 RETURNING *`,
    [req.user.initials, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

module.exports = router;
