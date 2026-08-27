const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const pool     = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');

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

router.post('/', async (req, res) => {
  const { name, email, phone, neighborhood, city, state, styles_taught, specialties, notes } = req.body;
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
    `INSERT INTO instructor_signups (name, email, phone, neighborhood, city, state, styles_taught, specialties, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [name.trim(), email || null, phone || null, neighborhood || null, city || null, state || null,
     styles_taught || null, specialties || null, notes || null]
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
  res.json(rows);
});

router.post('/:id/approve', async (req, res) => {
  const { rows: [signup] } = await pool.query('SELECT * FROM instructor_signups WHERE id = $1', [req.params.id]);
  if (!signup) return res.status(404).json({ error: 'Signup not found' });
  if (signup.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  // Same shape as the manual "Add Instructor" flow in instructors.js POST / — carry over
  // an already-signed contract if this email matches one, same as that route does.
  let signedFlag = 0, signedDate = null, signatureToLink = null, sigSsnEncrypted = null, sigSsnLast4 = null;
  if (signup.email) {
    const { rows: [sig] } = await pool.query(
      `SELECT id, signed_at, ssn_encrypted, ssn_last4 FROM instructor_contract_signatures
        WHERE email = $1 AND signed_at IS NOT NULL AND instructor_id IS NULL
        ORDER BY signed_at DESC LIMIT 1`,
      [signup.email]
    );
    if (sig) {
      signedFlag = 1; signedDate = sig.signed_at; signatureToLink = sig.id;
      sigSsnEncrypted = sig.ssn_encrypted; sigSsnLast4 = sig.ssn_last4;
    }
  }

  const { rows: [inst] } = await pool.query(
    `INSERT INTO instructors (name, phone, email, specialties, notes, neighborhood, city, state, styles_taught,
       contract_signed, contract_signed_date, ssn_encrypted, ssn_last4)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [signup.name, signup.phone || null, signup.email || null, signup.specialties || null, signup.notes || null,
     signup.neighborhood || null, signup.city || null, signup.state || null, signup.styles_taught || null,
     signedFlag, signedDate, sigSsnEncrypted, sigSsnLast4]
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
