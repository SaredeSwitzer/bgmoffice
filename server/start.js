// Startup entry point.
// 1. Opens (or creates) the database and runs all migrations via db/index.js
// 2. If the DB is brand new (no users), seeds essential config data
// 3. Then starts the Express server

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});

console.log('NODE_ENV:', process.env.NODE_ENV || '(not set — local dev)');
console.log('Working directory:', process.cwd());

const db = require('./db');           // migrations run here
const bcrypt = require('bcryptjs');

// ── Auto-seed if the database is empty ───────────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;

if (userCount === 0) {
  console.log('Fresh database detected — seeding config data…');

  db.transaction(() => {
    // Action types
    const insertAT = db.prepare(
      'INSERT INTO action_types (name, color, order_index) VALUES (@name, @color, @order_index)'
    );
    [
      { name: 'FOLLOW UP WITH INSTRUCTOR',                            color: 'blue',   order_index: 1 },
      { name: 'FOLLOW UP WITH CLIENT',                                color: 'green',  order_index: 2 },
      { name: 'REVIEW ISSUE WITH SAREDE',                             color: 'purple', order_index: 3 },
      { name: 'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL', color: 'teal',   order_index: 4 },
      { name: 'FOLLOW UP ON BLAST RESPONSES',                         color: 'orange', order_index: 5 },
      { name: 'ADD TO RECRUITING / SEND BLAST',                       color: 'pink',   order_index: 6 },
      { name: 'INSTRUCTOR AWAY - INFORM ALL CLIENTS',                 color: 'yellow', order_index: 7 },
      { name: 'UPDATE CALENDAR ENTRY',                                color: 'indigo', order_index: 8 },
      { name: 'UPDATE USAEPAY',                                       color: 'amber',  order_index: 9 },
      { name: 'UPDATE JOTFORM',                                       color: 'slate',  order_index: 10 },
    ].forEach(at => insertAT.run(at));
    console.log('  ✓ 10 action types (PRIORITY removed — use star/urgent instead)');

    // Delegates
    const insertD = db.prepare('INSERT INTO delegates (name) VALUES (?)');
    ['Sarede', 'Lyra', 'Maria', 'Claire'].forEach(n => insertD.run(n));
    console.log('  ✓ 4 delegates');

    // Users
    const insertU = db.prepare(
      'INSERT INTO users (name, initials, email, password_hash, role) VALUES (@name, @initials, @email, @password_hash, @role)'
    );
    [
      { name: 'Admin',    initials: 'AD', email: 'admin@bgmoffice.com',  password: 'admin123', role: 'admin' },
      { name: 'Sarede S', initials: 'SS', email: 'sarede@bgmoffice.com', password: 'staff123', role: 'staff' },
      { name: 'Lyra M',   initials: 'LM', email: 'lyra@bgmoffice.com',   password: 'staff123', role: 'staff' },
      { name: 'Maria A',  initials: 'MA', email: 'maria@bgmoffice.com',  password: 'staff123', role: 'staff' },
      { name: 'Claire M', initials: 'CM', email: 'claire@bgmoffice.com', password: 'staff123', role: 'staff' },
    ].forEach(u => insertU.run({
      name: u.name, initials: u.initials, email: u.email, role: u.role,
      password_hash: bcrypt.hashSync(u.password, 10),
    }));
    console.log('  ✓ 5 users');
  })();

  console.log('Seeding complete.');
} else {
  console.log(`Database ready (${userCount} users found).`);
}

// ── Emergency admin password reset ───────────────────────────────────────────
// Set RESET_ADMIN_PASSWORD=newpassword in Railway env vars, deploy once,
// then remove the env var. Never leave it set permanently.
if (process.env.RESET_ADMIN_PASSWORD) {
  const newHash = bcrypt.hashSync(process.env.RESET_ADMIN_PASSWORD, 10);
  const result = db.prepare(
    `UPDATE users SET password_hash=? WHERE role='admin'`
  ).run(newHash);
  console.log(`[reset] Admin password updated for ${result.changes} account(s). Remove RESET_ADMIN_PASSWORD env var now.`);
}

// ── Start the server ──────────────────────────────────────────────────────────
require('./index.js');
