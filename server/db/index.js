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

// One-time data migration: copy legacy action_type_id into junction table.
// Only runs when the junction table is completely empty (truly first boot after
// this feature shipped).  Running it on every boot would re-insert stale legacy
// values after users have reassigned types via the edit form.
const junctionEmpty = db.prepare('SELECT COUNT(*) AS n FROM action_item_action_types').get().n === 0;
if (junctionEmpty) {
  db.exec(`
    INSERT OR IGNORE INTO action_item_action_types (action_item_id, action_type_id)
    SELECT id, action_type_id FROM action_items WHERE action_type_id IS NOT NULL
  `);
  console.log('[migration] seeded action_item_action_types from legacy action_type_id column');
}

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

// instructor_documents table (added post-initial-schema)
db.exec(`
  CREATE TABLE IF NOT EXISTS instructor_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by TEXT NOT NULL
  )
`);

// ── Recruiting tables ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS recruiting_columns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    field_key     TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_system     INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recruiting_entries (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week    TEXT    NOT NULL CHECK(day_of_week IN ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
    time_slot      TEXT,
    neighborhood   TEXT,
    style          TEXT,
    participants   TEXT,
    client_name    TEXT,
    client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    address        TEXT,
    phone          TEXT,
    waiver_signed  INTEGER NOT NULL DEFAULT 0,
    instructor_info TEXT,
    client_rate    TEXT,
    extra_data     TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by     TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recruiting_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id        INTEGER NOT NULL REFERENCES recruiting_entries(id) ON DELETE CASCADE,
    text            TEXT    NOT NULL,
    author_initials TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Seed default columns (once — idempotent via count check)
try {
  const existingCols = db.prepare('SELECT COUNT(*) AS n FROM recruiting_columns WHERE is_system=1').get().n;
  if (existingCols === 0) {
    const ins = db.prepare('INSERT INTO recruiting_columns (name, field_key, display_order, is_system) VALUES (?,?,?,1)');
    [
      ['Time',                    'time_slot',       0],
      ['Neighborhood',            'neighborhood',    1],
      ['Style',                   'style',           2],
      ['Participants & Ages',     'participants',    3],
      ['Client Name',             'client_name',     4],
      ['Address',                 'address',         5],
      ['Phone',                   'phone',           6],
      ['Waiver Signed?',          'waiver_signed',   7],
      ['Instructor(s) / Rate',    'instructor_info', 8],
      ['Client Rate / Payment',   'client_rate',     9],
    ].forEach(([name, field_key, order]) => ins.run(name, field_key, order));
    console.log('[seed] recruiting_columns: 10 default columns inserted');
  }
} catch (err) {
  console.error('[seed] recruiting_columns failed (non-fatal):', err.message);
}

// Seed 3 sample Sunday recruiting entries (once)
try {
  const existingEntries = db.prepare('SELECT COUNT(*) AS n FROM recruiting_entries').get().n;
  if (existingEntries === 0) {
    const ins = db.prepare(`
      INSERT INTO recruiting_entries
        (day_of_week, time_slot, neighborhood, style, participants, client_name, address, phone, waiver_signed, instructor_info, client_rate, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const e1 = ins.run('Sunday','May 24 and June 21 and July 5 and 12 @ 11:30am','Borough Park','Any Style','10-15 Seniors','Connections','1021 38th St Brooklyn NY 11219 basement',null,1,null,null,'SS');
    ins.run('Sunday','May 31 11:45-12:45 PM','Manalapan NJ','Yoga','approx 10-12','Muka - Friendship Circle Central NJ','33 Gordons Corner Manalapan NJ',null,0,null,'$100','SS');
    ins.run('Sunday','9:30-10:30 AM','Williamsburg','General Fitness','1 age 54','Ephraim Gross','76 Hughes st top floor','917-846-6723',1,null,'$125','SS');
    const insN = db.prepare('INSERT INTO recruiting_notes (entry_id, text, author_initials) VALUES (?,?,?)');
    insN.run(e1.lastInsertRowid, 'Called Connections coordinator — they confirmed 10 seniors attending, basement room available. Asked about wheelchair access.', 'SS');
    insN.run(e1.lastInsertRowid, 'Sent instructor availability for May 24 slot. Waiting on confirmation.', 'SS');
    console.log('[seed] recruiting_entries: 3 sample Sunday entries inserted');
  }
} catch (err) {
  console.error('[seed] recruiting_entries failed (non-fatal):', err.message);
}

// App-wide key/value settings (e.g. Stripe keys)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Invoices
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number           TEXT    NOT NULL UNIQUE,
    client_id                INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    instructor_id            INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
    status                   TEXT    NOT NULL DEFAULT 'draft'
                               CHECK(status IN ('draft','sent','paid','overdue')),
    line_items               TEXT    NOT NULL DEFAULT '[]',
    subtotal                 REAL    NOT NULL DEFAULT 0,
    tax_rate                 REAL    NOT NULL DEFAULT 0,
    tax_amount               REAL    NOT NULL DEFAULT 0,
    total                    REAL    NOT NULL DEFAULT 0,
    notes                    TEXT,
    invoice_date             TEXT,
    due_date                 TEXT,
    stripe_payment_intent_id TEXT,
    stripe_client_secret     TEXT,
    paid_at                  TEXT,
    created_by               TEXT    NOT NULL,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Class packages
db.exec(`
  CREATE TABLE IF NOT EXISTS client_packages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
    total_classes INTEGER NOT NULL,
    classes_used  INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','completed','cancelled')),
    start_date    TEXT,
    notes         TEXT,
    created_by    TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS package_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id   INTEGER NOT NULL REFERENCES client_packages(id) ON DELETE CASCADE,
    session_date TEXT    NOT NULL,
    notes        TEXT,
    created_by   TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Standalone tasks (not linked to client/instructor)
db.exec(`
  CREATE TABLE IF NOT EXISTS standalone_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT,
    assigned_to TEXT,
    due_date    TEXT,
    priority    TEXT    NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent')),
    status      TEXT    NOT NULL DEFAULT 'open'   CHECK(status IN ('open','done')),
    starred     INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    created_by  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )
`);

// Idempotent column additions for existing DBs that predate these columns.
// Each ALTER TABLE is attempted; "duplicate column" errors are silently
// ignored. Any other error is logged so it shows up in Railway's deploy log.
const migrations = [
  `ALTER TABLE reminders         ADD COLUMN action_item_id INTEGER REFERENCES action_items(id) ON DELETE SET NULL`,
  `ALTER TABLE reminders         ADD COLUMN delegate_name  TEXT`,
  `ALTER TABLE action_items      ADD COLUMN starred        INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE follow_up_notes   ADD COLUMN updated_at     TEXT`,
  `ALTER TABLE reminders         ADD COLUMN updated_at     TEXT`,
  `ALTER TABLE action_items      ADD COLUMN updated_at     TEXT`,
  `ALTER TABLE client_instructor_prefs ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  `ALTER TABLE client_instructor_prefs ADD COLUMN created_by TEXT`,
  `ALTER TABLE action_items             ADD COLUMN created_by TEXT`,
  // profile-expansion columns (added 2026-06)
  `ALTER TABLE cases        ADD COLUMN title               TEXT`,
  `ALTER TABLE clients      ADD COLUMN rate_per_class      TEXT`,
  `ALTER TABLE instructors  ADD COLUMN mailing_address     TEXT`,
  `ALTER TABLE instructors  ADD COLUMN ssn                 TEXT`,
  `ALTER TABLE instructors  ADD COLUMN contract_signed     INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE instructors  ADD COLUMN contract_signed_date TEXT`,
  `ALTER TABLE instructors  ADD COLUMN photo_url           TEXT`,
  // contact person for clients (added 2026-06)
  `ALTER TABLE clients      ADD COLUMN contact_person_name  TEXT`,
  `ALTER TABLE clients      ADD COLUMN contact_person_phone TEXT`,
  `ALTER TABLE clients      ADD COLUMN contact_person_email TEXT`,
  `ALTER TABLE clients      ADD COLUMN contact_person_role  TEXT`,
  // client waiver (added 2026-06)
  `ALTER TABLE clients      ADD COLUMN waiver_signed        INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE clients      ADD COLUMN waiver_signed_date   TEXT`,
  // invoice title (added 2026-06)
  `ALTER TABLE invoices     ADD COLUMN title                TEXT`,
  // recruiting note tasks (added 2026-06)
  `ALTER TABLE recruiting_notes ADD COLUMN is_task     INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE recruiting_notes ADD COLUMN assigned_to TEXT`,
  `ALTER TABLE recruiting_notes ADD COLUMN is_done     INTEGER NOT NULL DEFAULT 0`,
  // link recruiting-note tasks to standalone_tasks (added 2026-06)
  `ALTER TABLE standalone_tasks  ADD COLUMN recruiting_note_id INTEGER`,
  `ALTER TABLE recruiting_notes  ADD COLUMN standalone_task_id INTEGER`,
  // client/instructor/action-type on standalone tasks (added 2026-06)
  `ALTER TABLE standalone_tasks  ADD COLUMN client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL`,
  `ALTER TABLE standalone_tasks  ADD COLUMN instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL`,
  `ALTER TABLE standalone_tasks  ADD COLUMN action_type_id INTEGER REFERENCES action_types(id) ON DELETE SET NULL`,
  // recruiting entry enrichment — linked instructor, action type, assigned user (added 2026-06)
  `ALTER TABLE recruiting_entries ADD COLUMN instructor_id       INTEGER REFERENCES instructors(id) ON DELETE SET NULL`,
  `ALTER TABLE recruiting_entries ADD COLUMN action_type_id      INTEGER REFERENCES action_types(id) ON DELETE SET NULL`,
  `ALTER TABLE recruiting_entries ADD COLUMN assigned_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  // task reply thread (added 2026-06)
  `ALTER TABLE standalone_tasks ADD COLUMN replies TEXT`,
];

// instructor availability table (added 2026-06)
db.exec(`
  CREATE TABLE IF NOT EXISTS instructor_availability (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    day_of_week   TEXT    NOT NULL,
    time_slot     TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

for (const sql of migrations) {
  try {
    db.exec(sql);
    // Extract "TABLE col" for a concise log line
    const m = sql.match(/ALTER TABLE (\S+)\s+ADD COLUMN (\S+)/i);
    if (m) console.log(`[migration] added column ${m[1]}.${m[2]}`);
  } catch (err) {
    if (/duplicate column/i.test(err.message)) {
      // Already exists — expected on every boot after the first
    } else {
      console.error(`[migration] FAILED: ${sql.trim()}\n  ${err.message}`);
    }
  }
}

// Backfill: create standalone_tasks for recruiting notes that were marked as tasks
// before the mirroring code existed (2026-06 and earlier)
const unmirroredNotes = db.prepare(`
  SELECT rn.*, re.client_name, re.day_of_week, re.time_slot
  FROM recruiting_notes rn
  JOIN recruiting_entries re ON re.id = rn.entry_id
  WHERE rn.is_task = 1 AND rn.standalone_task_id IS NULL
`).all();

if (unmirroredNotes.length > 0) {
  console.log(`[backfill] mirroring ${unmirroredNotes.length} existing recruiting task(s) to standalone_tasks`);
  const insertTask = db.prepare(`
    INSERT INTO standalone_tasks (title, assigned_to, notes, created_by, recruiting_note_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const linkNote = db.prepare(`UPDATE recruiting_notes SET standalone_task_id = ? WHERE id = ?`);

  const backfill = db.transaction(() => {
    for (const note of unmirroredNotes) {
      const context = [
        note.client_name ? `Client: ${note.client_name}` : null,
        note.day_of_week,
        note.time_slot || null,
      ].filter(Boolean).join(' · ');

      const result = insertTask.run(
        note.text,
        note.assigned_to || null,
        context || null,
        'system',
        note.id
      );
      linkNote.run(result.lastInsertRowid, note.id);
    }
  });
  backfill();
}

module.exports = db;
