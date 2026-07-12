// Applies every .sql file in ./migrations in name order, then backfills anything
// that needs generated values. Safe to re-run: the SQL is all IF NOT EXISTS and the
// backfills only touch NULL rows.
//
//   node server/db/migrate.js
//
// Reads DATABASE_URL from server/.env (same as the app).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const pool   = require('./pg');

async function main() {
  const dir = path.join(__dirname, 'migrations');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    process.stdout.write(`applying ${file} … `);
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    console.log('ok');
  }

  // Give every invoice that lacks one a random public token. Done here rather than in
  // SQL so we don't depend on the pgcrypto extension being present.
  const { rows } = await pool.query('SELECT id FROM invoices WHERE public_token IS NULL');
  for (const { id } of rows) {
    await pool.query('UPDATE invoices SET public_token = $1 WHERE id = $2', [
      crypto.randomBytes(16).toString('hex'),
      id,
    ]);
  }
  console.log(`backfilled public_token on ${rows.length} invoice(s)`);

  await pool.end();
}

main().catch(err => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
