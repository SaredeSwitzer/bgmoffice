// Restores users, delegates, and action_types without touching
// clients, instructors, cases, or any operational data.
const db = require('./index')
const bcrypt = require('bcryptjs')

db.transaction(() => {

  // ── Action Types ──────────────────────────────────────────────────────────
  db.prepare('DELETE FROM action_types').run()

  const insertActionType = db.prepare(
    'INSERT INTO action_types (name, color, order_index) VALUES (@name, @color, @order_index)'
  )
  const actionTypes = [
    { name: 'FOLLOW UP WITH INSTRUCTOR',                            color: 'blue',   order_index: 1 },
    { name: 'FOLLOW UP WITH CLIENT',                                color: 'green',  order_index: 2 },
    { name: 'REVIEW ISSUE WITH SAREDE',                             color: 'purple', order_index: 3 },
    { name: 'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL', color: 'teal',   order_index: 4 },
    { name: 'FOLLOW UP ON BLAST RESPONSES',                         color: 'orange', order_index: 5 },
    { name: 'ADD TO RECRUITING / SEND BLAST',                       color: 'pink',   order_index: 6 },
    { name: 'INSTRUCTOR AWAY - INFORM ALL CLIENTS',                 color: 'yellow', order_index: 7 },
    { name: 'PRIORITY',                                             color: 'red',    order_index: 8 },
    { name: 'UPDATE CALENDAR ENTRY',                                color: 'indigo', order_index: 9 },
    { name: 'UPDATE USAEPAY',                                       color: 'amber',  order_index: 10 },
    { name: 'UPDATE JOTFORM',                                       color: 'slate',  order_index: 11 },
  ]
  actionTypes.forEach(at => insertActionType.run(at))
  console.log(`  action_types: ${actionTypes.length} rows inserted`)

  // ── Delegates ─────────────────────────────────────────────────────────────
  db.prepare('DELETE FROM delegates').run()

  const insertDelegate = db.prepare('INSERT INTO delegates (name) VALUES (?)')
  const delegates = ['Sarede', 'Maria', 'Claire']
  delegates.forEach(d => insertDelegate.run(d))
  console.log(`  delegates: ${delegates.length} rows inserted`)

  // ── Users ─────────────────────────────────────────────────────────────────
  db.prepare('DELETE FROM users').run()

  const insertUser = db.prepare(
    'INSERT INTO users (name, initials, email, password_hash, role) VALUES (@name, @initials, @email, @password_hash, @role)'
  )
  const users = [
    { name: 'Admin',    initials: 'AD', email: 'admin@bgmoffice.com',  password: 'admin123', role: 'admin' },
    { name: 'Sarede S', initials: 'SS', email: 'sarede@bgmoffice.com', password: 'staff123', role: 'staff' },
    { name: 'Maria A',  initials: 'MA', email: 'maria@bgmoffice.com',  password: 'staff123', role: 'staff' },
    { name: 'Claire M', initials: 'CM', email: 'claire@bgmoffice.com', password: 'staff123', role: 'staff' },
  ]
  users.forEach(u => {
    insertUser.run({
      name: u.name,
      initials: u.initials,
      email: u.email,
      password_hash: bcrypt.hashSync(u.password, 10),
      role: u.role,
    })
  })
  console.log(`  users: ${users.length} rows inserted`)

})()

console.log('\nDone. Login with admin@bgmoffice.com / admin123 or staff email / staff123')
