const Database = require('better-sqlite3');
const path = require('path');

// In production (Railway), set DB_PATH to a path on the persistent volume, e.g. /data/bgmoffice.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bgmoffice.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Auto-migrate: create reminders table if it doesn't exist
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
