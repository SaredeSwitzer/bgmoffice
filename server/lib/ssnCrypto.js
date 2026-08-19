// Encrypts SSNs collected through the instructor contract-signing form (server/routes/
// instructorContract.js). AES-256-GCM with a key that lives only in SSN_ENCRYPTION_KEY
// (env var, never in the database) — a Supabase-only compromise can't decrypt these.
//
// Storage shape: "<iv>:<authTag>:<ciphertext>", all hex. Callers should also store
// last4(ssn) alongside the encrypted value so the app can show "•••-••-1234" without
// ever decrypting for a routine display.

const crypto = require('crypto');

function getKey() {
  const hex = process.env.SSN_ENCRYPTION_KEY;
  if (!hex) throw new Error('SSN_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('SSN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return key;
}

function encryptSSN(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptSSN(stored) {
  const [ivHex, tagHex, dataHex] = String(stored).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

function last4(ssn) {
  const digits = String(ssn || '').replace(/\D/g, '');
  return digits.slice(-4) || null;
}

module.exports = { encryptSSN, decryptSSN, last4 };
