const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In production (Railway), volume is mounted at /app/server/data so the DB lives there.
// Locally it falls back to a data/ folder next to db/.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bgmoffice.db');

// Make sure the directory exists (Railway volume is mounted at /data but the
// folder itself may not exist on first boot)
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// ── Schema migrations (idempotent — safe to run on every boot) ────────────────

// Core tables (schema.sql is the source of truth; this covers the reminders
// table which was added after initial deploy)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    notes         TEXT,
    remind_on     TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
    client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
    case_id       INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    created_by    TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

module.exports = db;
