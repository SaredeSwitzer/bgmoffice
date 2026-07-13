-- 002 — Passkeys (Touch ID / Face ID sign-in)
-- Run with: node server/db/migrate.js   (safe to run more than once)

-- One row per registered device. A user can have several (her Mac, her iPhone).
-- The credential_id is the handle the browser gives back at sign-in; public_key verifies
-- the signature. There is no secret here that is useful to an attacker — a stolen row can't
-- be used to sign in, because the private key never leaves her device's secure enclave.
CREATE TABLE IF NOT EXISTS passkeys (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT        NOT NULL UNIQUE,   -- base64url
  public_key    TEXT        NOT NULL,          -- base64url (COSE key)
  counter       BIGINT      NOT NULL DEFAULT 0,
  transports    TEXT,                          -- csv: internal,hybrid,usb…
  label         TEXT,                          -- "Sarede's MacBook" — so she can tell them apart
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys (user_id);

-- WebAuthn challenges must be single-use and short-lived, and this app runs on Vercel where
-- every request can land on a fresh instance — so they cannot live in process memory (the same
-- trap that made express-rate-limit useless here). They live in the database, shared by all
-- instances.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          BIGSERIAL PRIMARY KEY,
  challenge   TEXT        NOT NULL,
  user_id     BIGINT      REFERENCES users(id) ON DELETE CASCADE,  -- null for sign-in (we don't know who yet)
  purpose     TEXT        NOT NULL,            -- 'register' | 'login'
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_lookup_idx
  ON webauthn_challenges (challenge, purpose);

-- Same as every other table here: the app connects as the `postgres` owner (bypasses RLS),
-- and RLS-on keeps these invisible to Supabase's public REST API.
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
