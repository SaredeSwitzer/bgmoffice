const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const pool     = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { sendLoginCode } = require('../lib/mailer');
const { signToken, publicUser } = require('../lib/token');

const router = express.Router();

// Two ways to sign in, both ending in the same JWT the whole app already trusts:
//   1. Email a 6-digit code  (the everyday path — nothing to remember)
//   2. Email + password      (the backup path — a long random password kept in a
//                             password manager, for when email is down)

const CODE_TTL_MINUTES   = 10;  // how long a code stays good
const MAX_CODE_ATTEMPTS  = 5;   // wrong guesses before a code is burned
const MAX_CODES_PER_HOUR = 5;   // codes we'll email one user in a rolling hour

// NOTE: express-rate-limit's default store is in-memory. On Vercel each serverless
// instance gets its own memory, so this cap is leaky by design — it only slows a naive
// attacker reusing one warm instance. The real cap on the code path is enforced in the
// database below, which every instance shares.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again in 15 minutes.' },
});

// A user may type either their login name (maria@bgmoffice.com) or the real address the
// code is delivered to (maria@gmail.com) — both find the same account.
async function findUser(email) {
  const { rows } = await pool.query(
    `SELECT * FROM users
      WHERE active = 1
        AND (lower(email) = lower($1) OR lower(login_email) = lower($1))
      LIMIT 1`,
    [String(email).trim()]
  );
  return rows[0] || null;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// Hide most of the address so the screen can say where the code went without
// broadcasting the full email to whoever is looking at it.
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!domain) return 'your email';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}

// ── 1. Code sign-in ───────────────────────────────────────────────────────────

router.post('/request-code', loginLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = await findUser(email);
  // Deliberately NOT a generic "if that account exists, we sent a code". This is a
  // 4-person internal tool whose addresses are already known; telling Sarede plainly
  // that she mistyped is worth more than hiding which accounts exist. A wrong address
  // still gets an attacker nowhere — they'd need the code itself.
  if (!user) return res.status(404).json({ error: 'No account uses that email address.' });

  const destination = user.login_email || user.email;

  const { rows: [{ count }] } = await pool.query(
    `SELECT count(*)::int AS count FROM login_codes
      WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
    [user.id]
  );
  if (count >= MAX_CODES_PER_HOUR) {
    return res.status(429).json({
      error: 'Too many codes requested. Try again in an hour, or sign in with your password.',
    });
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  const { rows: [row] } = await pool.query(
    `INSERT INTO login_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
     RETURNING id`,
    [user.id, hashCode(code), String(CODE_TTL_MINUTES)]
  );

  try {
    await sendLoginCode(destination, code);
  } catch (err) {
    // Burn the code we couldn't deliver, and say so. Silently "succeeding" here would
    // leave her staring at the code box waiting for an email that is never coming.
    await pool.query('UPDATE login_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    console.error('[auth] could not send login code:', err.message);
    return res.status(500).json({ error: "We couldn't send the code. Sign in with your password instead." });
  }

  res.json({ ok: true, sent_to: maskEmail(destination), expires_in_minutes: CODE_TTL_MINUTES });
});

router.post('/verify-code', loginLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  const user = await findUser(email);
  if (!user) return res.status(401).json({ error: 'That code is wrong or has expired.' });

  const { rows: [record] } = await pool.query(
    `SELECT * FROM login_codes
      WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [user.id]
  );
  if (!record) return res.status(401).json({ error: 'That code is wrong or has expired.' });

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    await pool.query('UPDATE login_codes SET consumed_at = now() WHERE id = $1', [record.id]);
    return res.status(429).json({ error: 'Too many wrong guesses. Ask for a new code.' });
  }

  const supplied = hashCode(String(code).trim());
  const matches = supplied.length === record.code_hash.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(record.code_hash));

  if (!matches) {
    await pool.query('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    return res.status(401).json({ error: 'That code is wrong or has expired.' });
  }

  await pool.query('UPDATE login_codes SET consumed_at = now() WHERE id = $1', [record.id]);

  res.json({ token: signToken(user), user: publicUser(user) });
});

// ── 2. Password sign-in (backup) ──────────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await findUser(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, initials, email, role FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
