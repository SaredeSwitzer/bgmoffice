// Clears all operational data while preserving configuration tables
// (users, delegates, action_types remain untouched)
const db = require('./index')  // also auto-creates reminders table if missing

const tables = [
  'follow_up_notes',
  'action_items',
  'reminders',
  'cases',
  'clients',
  'instructors',
]

db.transaction(() => {
  for (const table of tables) {
    // Skip tables that don't exist yet (e.g. reminders on older local DBs)
    const exists = db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table)
    if (!exists) {
      console.log(`  ${table}: table not found, skipping`)
      continue
    }
    const { changes } = db.prepare(`DELETE FROM ${table}`).run()
    console.log(`  ${table}: ${changes} rows deleted`)
  }
})()

console.log('\nDone. Users, delegates, and action_types are untouched.')
