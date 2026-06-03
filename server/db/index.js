const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB path resolution:
//   Production (NODE_ENV=production): ALWAYS /app/server/data/bgmoffice.db
//     — this is the Railway persistent volume mount point
//     — DB_PATH env var is ignored in production to avoid misconfiguration
//   Local dev: db/bgmoffice.db next to this file
const PRODUCTION = process.env.NODE_ENV === 'production';
const DB_PATH = PRODUCTION
  ? '/app/server/data/bgmoffice.db'
  : (process.env.DB_PATH || path.join(__dirname, 'bgmoffice.db'));

console.log(`[db] env=${process.env.NODE_ENV || 'development'} path=${DB_PATH}`);

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
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT    NOT NULL,
    notes          TEXT,
    remind_on      TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
    client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    instructor_id  INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
    case_id        INTEGER REFERENCES cases(id) ON DELETE SET NULL,
    action_item_id INTEGER REFERENCES action_items(id) ON DELETE SET NULL,
    created_by     TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Junction table: one action item can have multiple action types
db.exec(`
  CREATE TABLE IF NOT EXISTS action_item_action_types (
    action_item_id INTEGER NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
    action_type_id INTEGER NOT NULL REFERENCES action_types(id) ON DELETE CASCADE,
    PRIMARY KEY (action_item_id, action_type_id)
  )
`);

// One-time data migration: copy existing single action_type_id into junction table
db.exec(`
  INSERT OR IGNORE INTO action_item_action_types (action_item_id, action_type_id)
  SELECT id, action_type_id FROM action_items WHERE action_type_id IS NOT NULL
`);

// Reference (internal wiki) sections
db.exec(`
  CREATE TABLE IF NOT EXISTS reference_sections (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    content       TEXT    NOT NULL DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by    TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Idempotent column additions for existing DBs that predate these columns
for (const sql of [
  `ALTER TABLE reminders         ADD COLUMN action_item_id INTEGER REFERENCES action_items(id) ON DELETE SET NULL`,
  `ALTER TABLE reminders         ADD COLUMN delegate_name  TEXT`,
  `ALTER TABLE action_items      ADD COLUMN starred        INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE follow_up_notes   ADD COLUMN updated_at     TEXT`,
  `ALTER TABLE reminders         ADD COLUMN updated_at     TEXT`,
  `ALTER TABLE action_items      ADD COLUMN updated_at     TEXT`,
]) {
  try { db.exec(sql) } catch (_) { /* column already exists — safe to ignore */ }
}

module.exports = db;
