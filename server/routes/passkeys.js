const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const pool = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { signToken, publicUser } = require('../lib/token');

const router = express.Router();

// Passkey sign-in: open the app, Touch ID / Face ID, in. No email, no code, no password.
//
// Like the email-code path, this is ADDITIVE: it ends in the exact same JWT the app already
// trusts, so requireAuth, every route, and the Settings UI are untouched. Delete these routes
// and the code + password paths still work. That property matters for an app its owner cannot
// debug herself.
//
// The private key never leaves her device's secure enclave. What we store here cannot be used
// to sign in — it only VERIFIES a signature. So a database leak does not hand anyone her account.

// The domain the passkey is bound to. A passkey created on bgmoffice.com will not work anywhere
// else — that's what makes it unphishable. Configurable so preview deploys / localhost can work.
const RP_ID = process.env.PASSKEY_RP_ID || 'bgmoffice.com';
const RP_NAME = 'BGM Office';
const ORIGINS = (process.env.PASSKEY_ORIGINS || 'https://bgmoffice.com,https://www.bgmoffice.com')
  .split(',')
  .map((o) => o.trim());

const CHALLENGE_TTL_MINUTES = 5;

async function saveChallenge(challenge, purpose, userId = null) {
  await pool.query(
    `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [challenge, userId, purpose, String(CHALLENGE_TTL_MINUTES)]
  );
}

// Single-use: taking a challenge consumes it, so a captured response can't be replayed.
async function takeChallenge(challenge, purpose) {
  const { rows } = await pool.query(
    `UPDATE webauthn_challenges SET consumed_at = now()
      WHERE id = (
        SELECT id FROM webauthn_challenges
         WHERE challenge = $1 AND purpose = $2
           AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1
      )
      RETURNING user_id`,
    [challenge, purpose]
  );
  return rows[0] || null;
}

// ── Registering a passkey (must already be signed in — by code or password) ───

router.post('/register/options', requireAuth, async (req, res) => {
  const { rows: [user] } = await pool.query(
    'SELECT id, name, email FROM users WHERE id = $1', [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { rows: existing } = await pool.query(
    'SELECT credential_id, transports FROM passkeys WHERE user_id = $1', [user.id]
  );

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    // Don't let her register the same device twice — it just confuses the list.
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? c.transports.split(',') : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',      // discoverable: lets her sign in WITHOUT typing an email
      userVerification: 'required', // Touch ID / Face ID / device PIN — must match the verify step
    },
  });

  await saveChallenge(options.challenge, 'register', user.id);
  res.json(options);
});

router.post('/register', requireAuth, async (req, res) => {
  const { response, label } = req.body;
  if (!response) return res.status(400).json({ error: 'Missing response' });

  const expected = await takeChallenge(response?.response?.clientDataJSON
    ? JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString()).challenge
    : '', 'register');
  if (!expected || String(expected.user_id) !== String(req.user.id)) {
    return res.status(400).json({ error: 'Challenge expired — try again.' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: JSON.parse(
        Buffer.from(response.response.clientDataJSON, 'base64url').toString()
      ).challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      // Keep in step with `userVerification: 'required'` in the options above. If the options
      // only *prefer* it, the authenticator may skip the biometric and this check then rejects
      // a legitimate sign-in — which is exactly how Touch ID broke for Maria.
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'Could not register that device.' });
  }

  const { credential } = verification.registrationInfo;
  await pool.query(
    `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, label)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      req.user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter ?? 0,
      (credential.transports || []).join(','),
      label || 'This device',
    ]
  );

  res.json({ ok: true });
});

// ── Signing in with a passkey (no email, no password) ─────────────────────────

router.post('/login/options', async (req, res) => {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    // No allowCredentials: the browser offers whichever passkey it has for this site, so she
    // never types an email. That is the whole point — open, touch, in.
  });
  await saveChallenge(options.challenge, 'login', null);
  res.json(options);
});

router.post('/login', async (req, res) => {
  const { response } = req.body;
  if (!response?.id) return res.status(400).json({ error: 'Missing response' });

  const challenge = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString()
  ).challenge;

  const taken = await takeChallenge(challenge, 'login');
  if (!taken) return res.status(400).json({ error: 'Sign-in expired — try again.' });

  const { rows: [pk] } = await pool.query(
    'SELECT * FROM passkeys WHERE credential_id = $1', [response.id]
  );
  if (!pk) return res.status(401).json({ error: 'That passkey is not registered.' });

  const { rows: [user] } = await pool.query(
    'SELECT * FROM users WHERE id = $1 AND active = 1', [pk.user_id]
  );
  if (!user) return res.status(401).json({ error: 'Account is not active.' });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      // Keep in step with `userVerification: 'required'` in the options above. If the options
      // only *prefer* it, the authenticator may skip the biometric and this check then rejects
      // a legitimate sign-in — which is exactly how Touch ID broke for Maria.
      requireUserVerification: true,
      credential: {
        id: pk.credential_id,
        publicKey: Buffer.from(pk.public_key, 'base64url'),
        counter: Number(pk.counter),
        transports: pk.transports ? pk.transports.split(',') : undefined,
      },
    });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  if (!verification.verified) return res.status(401).json({ error: 'Sign-in failed.' });

  // The counter guards against a cloned authenticator replaying an old signature.
  await pool.query(
    'UPDATE passkeys SET counter = $1, last_used_at = now() WHERE id = $2',
    [verification.authenticationInfo.newCounter, pk.id]
  );

  res.json({ token: signToken(user), user: publicUser(user) });
});

// ── Managing her passkeys ─────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at',
    [req.user.id]
  );
  res.json(rows);
});

router.delete('/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  res.json({ ok: true });
});

module.exports = router;
