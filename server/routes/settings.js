const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pg');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/action-types', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM action_types ORDER BY order_index ASC');
  res.json(rows);
});

router.post('/action-types', async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows: [max] } = await pool.query('SELECT MAX(order_index) AS m FROM action_types');
  const { rows: [at] } = await pool.query(
    'INSERT INTO action_types (name, color, order_index) VALUES ($1,$2,$3) RETURNING *',
    [name, color || 'gray', (max.m || 0) + 1]
  );
  res.status(201).json(at);
});

router.put('/action-types/:id', async (req, res) => {
  const { name, color, order_index } = req.body;
  const { rows: [existing] } = await pool.query('SELECT id FROM action_types WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { rows: [at] } = await pool.query(
    'UPDATE action_types SET name=$1, color=$2, order_index=$3 WHERE id=$4 RETURNING *',
    [name, color, order_index, req.params.id]
  );
  res.json(at);
});

router.delete('/action-types/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM action_types WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.patch('/action-types/reorder', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  await Promise.all(items.map(({ id, order_index }) =>
    pool.query('UPDATE action_types SET order_index=$1 WHERE id=$2', [order_index, id])
  ));
  const { rows } = await pool.query('SELECT * FROM action_types ORDER BY order_index ASC');
  res.json(rows);
});

router.get('/delegates', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM delegates ORDER BY name');
  res.json(rows);
});

router.post('/delegates', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows: [delegate] } = await pool.query('INSERT INTO delegates (name) VALUES ($1) RETURNING *', [name]);
  res.status(201).json(delegate);
});

router.put('/delegates/:id', async (req, res) => {
  const { name } = req.body;
  const result = await pool.query('UPDATE delegates SET name=$1 WHERE id=$2', [name, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  const { rows: [delegate] } = await pool.query('SELECT * FROM delegates WHERE id = $1', [req.params.id]);
  res.json(delegate);
});

router.delete('/delegates/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM delegates WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.initials, u.email, u.login_email, u.role, u.active, u.created_at, u.last_login_at,
            u.instructor_id::int, i.name AS instructor_name,
            (i.photo_url IS NOT NULL) AS instructor_has_photo,
            (SELECT COUNT(*) FROM instructor_documents d WHERE d.instructor_id = i.id)::int AS instructor_doc_count
       FROM users u
       LEFT JOIN instructors i ON i.id = u.instructor_id
      ORDER BY u.name`
  );
  res.json(rows);
});

// An 'instructor' account must point at exactly one instructor record, and a non-instructor
// account must not point at one. The DB enforces the first half (users_instructor_link_check);
// this resolves and validates the link so the caller gets a clear 400 instead of a 500 from a
// constraint violation. Returns { error } on failure, { value } on success.
async function resolveInstructorLink(role, instructor_id) {
  if (role !== 'instructor') return { value: null };
  if (instructor_id === undefined || instructor_id === null || instructor_id === '')
    return { error: 'instructor_id is required when role is instructor' };

  const id = Number(instructor_id);
  if (!Number.isInteger(id)) return { error: 'instructor_id must be a number' };

  const { rows: [instructor] } = await pool.query('SELECT id FROM instructors WHERE id = $1', [id]);
  if (!instructor) return { error: `No instructor with id ${id}` };

  return { value: id };
}

// `email` is the name on the account; `login_email` is where a sign-in code is posted.
// They are not the same thing and the difference has bitten twice: nobody's
// @bgmoffice.com address is a real mailbox — the app only *sends* from login@bgmoffice.com
// — so an account with no login_email can never receive a code, and is password-only
// without saying so. Claire had exactly that for two months.
// Who has signed in lately, and how. Admin-only, like the rest of this file.
//
// The single last_login_at stamp could only ever say "somebody signed in as Claire on
// Tuesday". This says which way they came in and from what — enough to tell a routine
// sign-in from one worth asking about.
router.get('/login-history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const { rows } = await pool.query(
    `SELECT e.id, e.method, e.device, e.ip, e.created_at,
            u.name, u.initials, u.email, u.role
       FROM login_events e JOIN users u ON u.id = e.user_id
      ${req.query.user_id ? 'WHERE e.user_id = $2' : ''}
      ORDER BY e.created_at DESC
      LIMIT $1`,
    req.query.user_id ? [limit, req.query.user_id] : [limit]
  );
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { name, initials, email, password, role, instructor_id, login_email } = req.body;
  if (!name || !initials || !email || !password || !role)
    return res.status(400).json({ error: 'name, initials, email, password, role required' });

  const link = await resolveInstructorLink(role, instructor_id);
  if (link.error) return res.status(400).json({ error: link.error });

  const password_hash = bcrypt.hashSync(password, 10);
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (name, initials, email, password_hash, role, instructor_id, login_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, initials, email, login_email, role, active, instructor_id`,
    [name, initials, email, password_hash, role, link.value, login_email?.trim() || null]
  );
  res.status(201).json(user);
});

router.put('/users/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const { name, initials, email, role, password, instructor_id, login_email } = req.body;
  // Absent means leave it alone — a form that doesn't ask must not silently cut somebody
  // off from their sign-in codes.
  const nextLoginEmail = login_email === undefined ? undefined : (login_email?.trim() || null);

  // Also covers switching an existing account to/from 'instructor': promoting without a link
  // would otherwise fail the DB constraint with a 500, and demoting has to clear the link.
  const link = await resolveInstructorLink(role, instructor_id);
  if (link.error) return res.status(400).json({ error: link.error });

  const sets = ['name=$1', 'initials=$2', 'email=$3', 'role=$4', 'instructor_id=$5'];
  const args = [name, initials, email, role, link.value];
  if (password) { args.push(bcrypt.hashSync(password, 10)); sets.push(`password_hash=$${args.length}`); }
  if (nextLoginEmail !== undefined) { args.push(nextLoginEmail); sets.push(`login_email=$${args.length}`); }
  args.push(req.params.id);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${args.length}`, args);

  const { rows: [user] } = await pool.query('SELECT id, name, initials, email, login_email, role, active, instructor_id FROM users WHERE id = $1', [req.params.id]);
  res.json(user);
});

router.patch('/users/:id/active', async (req, res) => {
  const { active } = req.body;
  const result = await pool.query('UPDATE users SET active=$1 WHERE id=$2', [active ? 1 : 0, req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  const { rows: [user] } = await pool.query('SELECT id, name, initials, email, role, active FROM users WHERE id = $1', [req.params.id]);
  res.json(user);
});

router.get('/stripe', async (req, res) => {
  const { rows: [pub] }    = await pool.query("SELECT value FROM app_settings WHERE key='stripe_publishable_key'");
  const { rows: [secret] } = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  res.json({
    publishable_key: pub?.value || '',
    secret_key_set: !!(secret?.value || process.env.STRIPE_SECRET_KEY),
  });
});

router.post('/stripe', async (req, res) => {
  const { publishable_key, secret_key, webhook_secret } = req.body;
  const upsert = (key, val) => pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [key, val]
  );
  if (publishable_key !== undefined) await upsert('stripe_publishable_key', publishable_key);
  if (secret_key)     await upsert('stripe_secret_key', secret_key);
  if (webhook_secret) await upsert('stripe_webhook_secret', webhook_secret);
  res.json({ ok: true });
});

// Instructor confirmation email template (editable wording). Placeholders in {curly braces}
// are filled from the class when sending: {instructor_name} {client_name} {day} {time}
// {location} {style} {rate}.
router.get('/confirmation-template', async (req, res) => {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('instructor_confirm_subject','instructor_confirm_body')"
  );
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ subject: m.instructor_confirm_subject || '', body: m.instructor_confirm_body || '' });
});

router.post('/confirmation-template', async (req, res) => {
  const { subject, body } = req.body;
  const upsert = (key, val) => pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [key, val]
  );
  if (subject !== undefined) await upsert('instructor_confirm_subject', subject);
  if (body !== undefined)    await upsert('instructor_confirm_body', body);
  res.json({ ok: true });
});

// The business's own Venmo handle — instructors deep-link a payout request here from
// their weekly pay nudge (client/src/components/PayoutNudge.jsx). Read side lives at
// GET /schedule/my-venmo-target (instructor-accessible); this admin-only pair is just
// for setting it.
router.get('/venmo', async (req, res) => {
  const { rows: [row] } = await pool.query("SELECT value FROM app_settings WHERE key='business_venmo_handle'");
  res.json({ handle: row?.value || '' });
});

router.post('/venmo', async (req, res) => {
  const { handle } = req.body;
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('business_venmo_handle', $1, to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [handle || '']
  );
  res.json({ ok: true });
});

module.exports = router;
