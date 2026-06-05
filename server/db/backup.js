/**
 * SQLite backup utility.
 *
 * Run manually:  node server/db/backup.js
 * Called automatically at server startup (from db/index.js) to keep a
 * rolling 7-day archive of the database.
 *
 * Production backups go to /app/server/data/backups/
 * Local dev backups go to server/db/backups/
 */

const path = require('path');
const fs   = require('fs');

const PRODUCTION  = process.env.NODE_ENV === 'production';
const DB_PATH     = PRODUCTION
  ? '/app/server/data/bgmoffice.db'
  : path.join(__dirname, 'bgmoffice.db');
const BACKUP_DIR  = PRODUCTION
  ? '/app/server/data/backups'
  : path.join(__dirname, 'backups');
const KEEP_DAYS   = 7;

function runBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[backup] DB not found at', DB_PATH, '— skipping');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destFile = path.join(BACKUP_DIR, `bgmoffice-${stamp}.db`);

  fs.copyFileSync(DB_PATH, destFile);
  console.log(`[backup] saved → ${destFile}`);

  // Prune backups older than KEEP_DAYS
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('bgmoffice-') && f.endsWith('.db'))
    .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .filter(({ mtime }) => mtime < cutoff)
    .forEach(({ f }) => {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`[backup] pruned old backup: ${f}`);
    });
}

module.exports = { runBackup };

// Allow running directly: node db/backup.js
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  runBackup();
}
