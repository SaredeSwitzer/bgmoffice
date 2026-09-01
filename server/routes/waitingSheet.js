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
                'id', p.id, 'kind', p.kind, 'person_id', p.person_id, 'name', p.name)
              ORDER BY p.created_at)
         FROM waiting_sheet_people p WHERE p.row_id = r.id),
      '[]'::json
    ) AS people
  FROM waiting_sheet_rows r
`;

async function getRow(id) {
  const { rows: [row] } = await pool.query(`${ROW_SQL} WHERE r.id = $1`, [id]);
  return row || null;
}

// Open rows, urgent first, then oldest — the order you'd work them in.
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `${ROW_SQL} WHERE r.status = 'open' ORDER BY r.urgent DESC, r.created_at ASC`
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
  const { what, people = [], urgent = false } = req.body;
  if (!what?.trim()) return res.status(400).json({ error: 'Say what you\'re waiting for' });

  const { rows: [row] } = await pool.query(
    `INSERT INTO waiting_sheet_rows (what, urgent, created_by) VALUES ($1,$2,$3) RETURNING id`,
    [what.trim(), !!urgent, req.user.initials]
  );
  for (const p of people) {
    if (!p?.name?.trim()) continue;
    await pool.query(
      `INSERT INTO waiting_sheet_people (row_id, kind, person_id, name) VALUES ($1,$2,$3,$4)`,
      [row.id, p.kind === 'instructor' ? 'instructor' : 'client', p.person_id || null, p.name.trim()]
    );
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
router.patch('/:id/waiting-on', async (req, res) => {
  const personId = req.body.person_id || null;
  let kind = null;
  if (personId) {
    const { rows: [p] } = await pool.query(
      'SELECT kind FROM waiting_sheet_people WHERE id = $1 AND row_id = $2', [personId, req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'That person is not on this row' });
    kind = p.kind;
  }
  const { rows: [row] } = await pool.query(
    `UPDATE waiting_sheet_rows SET waiting_on_id = $1, waiting_on_kind = $2, updated_at = now()
      WHERE id = $3 RETURNING id`,
    [personId, kind, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(await getRow(req.params.id));
});

router.post('/:id/people', async (req, res) => {
  const { kind, person_id, name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Pick or type a name' });
  await pool.query(
    `INSERT INTO waiting_sheet_people (row_id, kind, person_id, name) VALUES ($1,$2,$3,$4)`,
    [req.params.id, kind === 'instructor' ? 'instructor' : 'client', person_id || null, name.trim()]
  );
  res.status(201).json(await getRow(req.params.id));
});

router.delete('/:id/people/:personId', async (req, res) => {
  // If the ball was with the person being removed, it's nobody's until someone says.
  await pool.query(
    `UPDATE waiting_sheet_rows SET waiting_on_id = NULL, waiting_on_kind = NULL
      WHERE id = $1 AND waiting_on_id = $2`,
    [req.params.id, req.params.personId]
  );
  await pool.query('DELETE FROM waiting_sheet_people WHERE id = $1 AND row_id = $2',
    [req.params.personId, req.params.id]);
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

// The one the current person should read. Not marked read automatically — that happens
// when they say they've read it, so it can't be cleared by an accidental page load.
router.get('/handoff/latest', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM shift_handoffs ORDER BY created_at DESC LIMIT 1'
  );
  res.json(row || null);
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
  const waitingLabel = row => {
    const who = (row.people || []).find(p => p.id === row.waiting_on_id);
    return who ? `${who.name} — ${row.what}` : label(row);
  };

  res.json({
    urgent:    rows.filter(r => r.urgent).map(label).join('\n'),
    // Names only on purpose: the detail lives in the app, and a handoff that restates it
    // goes stale the moment someone updates the record.
    follow_up: rows.filter(r => !r.urgent && !r.waiting_on_id).map(label).join('\n'),
    waiting:   rows.filter(r => !r.urgent && r.waiting_on_id).map(waitingLabel).join('\n'),
  });
});

router.post('/handoff', async (req, res) => {
  const { urgent, follow_up, waiting, notes } = req.body;
  const { rows: [row] } = await pool.query(
    `INSERT INTO shift_handoffs (author, urgent, follow_up, waiting, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.initials, urgent || null, follow_up || null, waiting || null, notes || null]
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
