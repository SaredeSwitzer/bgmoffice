const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const pool     = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { notifyCrew } = require('../lib/notifyCrew');
const { findDuplicateInstructors, describeDuplicates } = require('../lib/findDuplicateInstructors');

const router = express.Router();

// "Jane Doe" -> "JD" — mirrors the same helper in instructors.js (not shared/exported
// there, so duplicated here rather than reaching across files for one small function).
function deriveInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] || '').slice(0, 2).toUpperCase();
}

// ── Public — the /join page an instructor fills out themselves, no login required.
// Same-origin React page (not an external webhook like recruitingIntake.js), so no
// shared-secret check — just skips requireAuth, same pattern as instructorContract.js's
// public token routes. Placed before router.use(requireAuth) below, which is what
// actually makes it public (Express middleware only applies to routes registered after it).

// Drops a task on Sarede's My Tasks (assigned_to matches her `delegates` row, same
// lookup dashboard.js's /my-tasks uses) whenever an instructor adds a brand new
// neighborhood or class style to the shared list — from the public /join page or from
// their own profile once they're in. She wasn't the one who typed it, so this is how she
// finds out a new option now exists site-wide.
async function notifySaredeNewOption(kind, name) {
  // created_at is TEXT here (a SQLite-era leftover) and its default writes UTC, which the
  // dashboard's age math then reads as local — enough to render a fresh task as "-1d".
  // Write the local-time string the rest of the app's rows use instead.
  await pool.query(
    `INSERT INTO standalone_tasks (title, notes, assigned_to, task_type, created_by, created_at)
     VALUES ($1,$2,'Sarede','other','signup', to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS'))`,
    [`New ${kind} added by an instructor: "${name}"`, 'Typed in by an instructor (sign-up form or their own profile) — just flagging it so you know it\'s now an option everywhere.']
  );
}

// Neighborhoods — the NY-only "click off which neighborhoods you can teach in" picker on
// /join reads/writes this list. Public GET so the unauthenticated signup page can show
// the current options; public POST so a name typed there that isn't in the list yet gets
// added immediately (same "public write, staff notices after" trust level as the signup
// itself) instead of only ever being free text nobody else's picker will ever offer.
// The borough/area headings the picker groups under. Kept server-side so the sign-up
// page, the instructor's own profile and the staff screens can't drift apart.
const NEIGHBORHOOD_REGIONS = [
  'Brooklyn', 'Manhattan', 'Queens', 'Bronx', 'Staten Island',
  'Westchester & Upstate', 'Long Island', 'New Jersey', 'Other',
];

router.get('/neighborhoods', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM neighborhoods ORDER BY name');
  res.json({ neighborhoods: rows, regions: NEIGHBORHOOD_REGIONS });
});

router.post('/neighborhoods', async (req, res) => {
  const { name, region } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const trimmed = name.trim();
  const { rows: [existing] } = await pool.query('SELECT * FROM neighborhoods WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (existing) return res.json(existing);
  // Anything not one of the known headings lands in "Other" rather than inventing a new
  // heading from whatever a stranger typed.
  const safeRegion = NEIGHBORHOOD_REGIONS.includes(region) ? region : 'Other';
  const { rows: [row] } = await pool.query(
    'INSERT INTO neighborhoods (name, region) VALUES ($1,$2) RETURNING *', [trimmed, safeRegion]
  );
  await notifySaredeNewOption('neighborhood', `${trimmed} (${safeRegion})`);
  res.status(201).json(row);
});

// Class styles — same idea, but for the "what do you teach" autocomplete. Deliberately a
// separate public GET/POST from the authenticated ones in recruiting.js (that router
// requires a login start to finish) rather than carving an exception into it — this stays
// scoped to what the public signup page actually needs.
router.get('/class-styles', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM class_styles ORDER BY name');
  res.json(rows);
});

router.post('/class-styles', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const trimmed = name.trim();
  const { rows: [existing] } = await pool.query('SELECT * FROM class_styles WHERE LOWER(name) = LOWER($1)', [trimmed]);
  if (existing) return res.json(existing);
  const { rows: [row] } = await pool.query('INSERT INTO class_styles (name) VALUES ($1) RETURNING *', [trimmed]);
  await notifySaredeNewOption('class style', trimmed);
  res.status(201).json(row);
});

router.post('/', async (req, res) => {
  const { name, email, phone, neighborhood, city, state, styles_taught, specialties, notes, heard_about_us } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  // Someone who already has a login is trying to sign up again — a form submission
  // with no client-side memory of prior visits can't know that on its own. Tell them to
  // sign in instead of quietly filing another pending signup nobody will notice needs
  // rejecting. Anything without an actual login yet (approved-but-no-account,
  // already-pending) still just gets treated as a normal resubmission below.
  if (email?.trim()) {
    const { rows: [existingUser] } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = 'instructor'`,
      [email.trim()]
    );
    if (existingUser) {
      return res.status(200).json({ already_registered: true });
    }
  }

  const { rows: [signup] } = await pool.query(
    `INSERT INTO instructor_signups (name, email, phone, neighborhood, city, state, styles_taught, specialties, notes, heard_about_us)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [name.trim(), email || null, phone || null, neighborhood || null, city || null, state || null,
     styles_taught || null, specialties || null, notes || null, heard_about_us?.trim() || null]
  );

  // Ping the crew Telegram — a sign-up sits in Instructors → Sign-ups waiting to be
  // approved, and nothing else would surface it until someone happened to look.
  const where = [neighborhood, [city, state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const dupes = await findDuplicateInstructors({ name: name.trim(), email, phone });
  await notifyCrew(
    `🙋 New instructor sign-up: ${name.trim()}` +
    (email ? `\n${email}` : '') +
    (where ? `\n${where}` : '') +
    (styles_taught ? `\nTeaches: ${styles_taught}` : '') +
    (heard_about_us?.trim() ? `\nHeard about us: ${heard_about_us.trim()}` : '') +
    (dupes.length ? `\n\n⚠️ Might already be on file: ${describeDuplicates(dupes)}` : '') +
    `\n\nApprove or decline in Instructors → Sign-ups.`
  );

  res.status(201).json({ id: signup.id });
});

// ── Staff — review, approve (creates the real instructor + login), or reject ─────────

router.use(requireAuth, requireStaff);

router.get('/', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let sql = 'SELECT * FROM instructor_signups';
  if (status) { params.push(status); sql += ` WHERE status = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(sql, params);

  // Flag sign-ups that look like someone we already have, so staff see it on the
  // approval card rather than discovering the duplicate months later.
  const withDupes = await Promise.all(rows.map(async row => ({
    ...row,
    possible_duplicates: row.status === 'pending'
      ? await findDuplicateInstructors({ name: row.name, email: row.email, phone: row.phone })
      : [],
  })));
  res.json(withDupes);
});

router.post('/:id/approve', async (req, res) => {
  const { rows: [signup] } = await pool.query('SELECT * FROM instructor_signups WHERE id = $1', [req.params.id]);
  if (!signup) return res.status(404).json({ error: 'Signup not found' });
  if (signup.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  // Same shape as the manual "Add Instructor" flow in instructors.js POST / — carry over
  // an already-signed contract if this email matches one, same as that route does.
  let signedFlag = 0, signedDate = null, signatureToLink = null, sigSsnEncrypted = null, sigSsnLast4 = null;
  let sigTaxIdType = 'ssn';
  if (signup.email) {
    const { rows: [sig] } = await pool.query(
      `SELECT id, signed_at, ssn_encrypted, ssn_last4, tax_id_type FROM instructor_contract_signatures
        WHERE email = $1 AND signed_at IS NOT NULL AND instructor_id IS NULL
        ORDER BY signed_at DESC LIMIT 1`,
      [signup.email]
    );
    if (sig) {
      signedFlag = 1; signedDate = sig.signed_at; signatureToLink = sig.id;
      sigSsnEncrypted = sig.ssn_encrypted; sigSsnLast4 = sig.ssn_last4;
      sigTaxIdType = sig.tax_id_type || 'ssn';
    }
  }

  const { rows: [inst] } = await pool.query(
    `INSERT INTO instructors (name, phone, email, specialties, notes, neighborhood, city, state, styles_taught,
       contract_signed, contract_signed_date, ssn_encrypted, ssn_last4, tax_id_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    // Approving clears the sign-up card, so carry how they found us into the instructor's
    // notes — otherwise it's only visible in the signups table nobody looks at.
    [signup.name, signup.phone || null, signup.email || null, signup.specialties || null,
     [signup.notes, signup.heard_about_us ? `Heard about us: ${signup.heard_about_us}` : null]
       .filter(Boolean).join('\n\n') || null,
     signup.neighborhood || null, signup.city || null, signup.state || null, signup.styles_taught || null,
     signedFlag, signedDate, sigSsnEncrypted, sigSsnLast4, sigTaxIdType]
  );
  if (signatureToLink) {
    await pool.query('UPDATE instructor_contract_signatures SET instructor_id = $1 WHERE id = $2', [inst.id, signatureToLink]);
  }

  // Same auto-login-account creation as instructors.js POST / — sign-in is an emailed
  // one-time code (server/routes/auth.js), never this random password.
  let hasLogin = false;
  if (signup.email) {
    const { rows: [existingUser] } = await pool.query('SELECT id FROM users WHERE email = $1', [signup.email]);
    if (!existingUser) {
      const randomPassword = crypto.randomBytes(24).toString('hex');
      await pool.query(
        `INSERT INTO users (name, initials, email, password_hash, role, instructor_id)
         VALUES ($1,$2,$3,$4,'instructor',$5)`,
        [signup.name, deriveInitials(signup.name), signup.email, bcrypt.hashSync(randomPassword, 10), inst.id]
      );
      hasLogin = true;
    }
  }

  await pool.query(
    `UPDATE instructor_signups SET status = 'approved', instructor_id = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
    [inst.id, req.user.initials, req.params.id]
  );

  res.json({ instructor_id: inst.id, has_login: hasLogin });
});

router.post('/:id/reject', async (req, res) => {
  const result = await pool.query(
    `UPDATE instructor_signups SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
      WHERE id = $2 AND status = 'pending'`,
    [req.user.initials, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Signup not found or already reviewed' });
  res.json({ success: true });
});

module.exports = router;
