const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'bgmoffice.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// ── Action Types ──────────────────────────────────────────────────────────────
const actionTypes = [
  { name: 'FOLLOW UP WITH INSTRUCTOR',                   color: 'blue',   order_index: 1 },
  { name: 'FOLLOW UP WITH CLIENT',                       color: 'green',  order_index: 2 },
  { name: 'REVIEW ISSUE WITH SAREDE',                    color: 'purple', order_index: 3 },
  { name: 'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL', color: 'teal', order_index: 4 },
  { name: 'FOLLOW UP ON BLAST RESPONSES',                color: 'orange', order_index: 5 },
  { name: 'ADD TO RECRUITING / SEND BLAST',              color: 'pink',   order_index: 6 },
  { name: 'INSTRUCTOR AWAY - INFORM ALL CLIENTS',        color: 'yellow', order_index: 7 },
  { name: 'PRIORITY',                                    color: 'red',    order_index: 8 },
  { name: 'UPDATE CALENDAR ENTRY',                       color: 'indigo', order_index: 9 },
  { name: 'UPDATE USAEPAY',                              color: 'amber',  order_index: 10 },
  { name: 'UPDATE JOTFORM',                              color: 'slate',  order_index: 11 },
];

const insertActionType = db.prepare(
  'INSERT INTO action_types (name, color, order_index) VALUES (@name, @color, @order_index)'
);
actionTypes.forEach(at => insertActionType.run(at));

// ── Delegates ─────────────────────────────────────────────────────────────────
const delegates = ['Sarede', 'Maria', 'Claire'];
const insertDelegate = db.prepare('INSERT INTO delegates (name) VALUES (?)');
delegates.forEach(d => insertDelegate.run(d));

// ── Users ─────────────────────────────────────────────────────────────────────
const insertUser = db.prepare(
  'INSERT INTO users (name, initials, email, password_hash, role) VALUES (@name, @initials, @email, @password_hash, @role)'
);

const users = [
  { name: 'Admin',          initials: 'AD', email: 'admin@bgmoffice.com', password: 'admin123',  role: 'admin' },
  { name: 'Maria A',        initials: 'MA', email: 'maria@bgmoffice.com', password: 'staff123',  role: 'staff' },
  { name: 'Sarede S',       initials: 'SS', email: 'sarede@bgmoffice.com',password: 'staff123',  role: 'staff' },
  { name: 'Claire M',       initials: 'CM', email: 'claire@bgmoffice.com',password: 'staff123',  role: 'staff' },
];

users.forEach(u => {
  const password_hash = bcrypt.hashSync(u.password, 10);
  insertUser.run({ name: u.name, initials: u.initials, email: u.email, password_hash, role: u.role });
});

// ── Instructors ───────────────────────────────────────────────────────────────
const insertInstructor = db.prepare(
  'INSERT INTO instructors (name, phone, email, specialties, style, notes, pay_rate) VALUES (@name, @phone, @email, @specialties, @style, @notes, @pay_rate)'
);

const instructors = [
  {
    name: 'Whitney',
    phone: '917-555-0101',
    email: 'whitney@example.com',
    specialties: 'Pilates, Yoga',
    style: 'Calm, methodical, great with beginners',
    notes: 'Very reliable. Clients love her energy.',
    pay_rate: '$85/hr',
  },
  {
    name: 'David Ostrevsky',
    phone: '917-555-0202',
    email: 'david.o@example.com',
    specialties: 'Strength Training, HIIT',
    style: 'High-energy, motivational, pushes clients hard',
    notes: 'Best for advanced clients. Occasionally unavailable on Fridays.',
    pay_rate: '$95/hr',
  },
  {
    name: 'Sharon Moreno',
    phone: '917-555-0303',
    email: 'sharon.m@example.com',
    specialties: 'Dance Cardio, Barre, Stretch',
    style: 'Fun, upbeat, great rapport',
    notes: 'Popular with clients 40+. Always sends a recap after sessions.',
    pay_rate: '$80/hr',
  },
];

instructors.forEach(i => insertInstructor.run(i));

// ── Clients ───────────────────────────────────────────────────────────────────
const insertClient = db.prepare(
  'INSERT INTO clients (name, phone, email, preferred_contact, notes) VALUES (@name, @phone, @email, @preferred_contact, @notes)'
);

const clients = [
  {
    name: 'Rivky Wagschal',
    phone: '718-555-1001',
    email: 'rivky@example.com',
    preferred_contact: 'whatsapp',
    notes: 'Prefers morning sessions. Very punctual.',
  },
  {
    name: 'Leah Farkas',
    phone: '718-555-1002',
    email: 'leah@example.com',
    preferred_contact: 'text',
    notes: 'Needs low-impact workouts due to knee issue.',
  },
  {
    name: 'Miri Singer',
    phone: '718-555-1003',
    email: 'miri@example.com',
    preferred_contact: 'email',
    notes: 'Interested in expanding to 3 sessions/week.',
  },
  {
    name: 'Ephraim Grossman',
    phone: '718-555-1004',
    email: 'ephraim@example.com',
    preferred_contact: 'call',
    notes: 'Corporate client. Flexible scheduling.',
  },
];

clients.forEach(c => insertClient.run(c));

// ── Client-Instructor Preferences ────────────────────────────────────────────
const insertPref = db.prepare(
  'INSERT INTO client_instructor_prefs (client_id, instructor_id, preference, reason) VALUES (?, ?, ?, ?)'
);

// Rivky likes Whitney, dislikes David
insertPref.run(1, 1, 'liked',    'Very calming, helped with posture goals');
insertPref.run(1, 2, 'disliked', 'Too intense, felt rushed');
// Leah likes Whitney and Sharon
insertPref.run(2, 1, 'liked',    'Gentle approach, great for her knee');
insertPref.run(2, 3, 'liked',    'Fun classes, always leaves happy');
// Miri likes David
insertPref.run(3, 2, 'liked',    'Loves the challenge, seeing great results');
// Ephraim no strong dislikes, likes Sharon
insertPref.run(4, 3, 'liked',    'Great with scheduling flexibility');

// ── Cases + Action Items + Follow-up Notes ────────────────────────────────────
const insertCase = db.prepare(
  'INSERT INTO cases (client_id, instructor_id, status, created_at) VALUES (@client_id, @instructor_id, @status, @created_at)'
);
const insertActionItem = db.prepare(
  'INSERT INTO action_items (case_id, action_type_id, delegate_id, status, initial_note, created_at) VALUES (@case_id, @action_type_id, @delegate_id, @status, @initial_note, @created_at)'
);
const insertNote = db.prepare(
  'INSERT INTO follow_up_notes (action_item_id, text, author_initials, created_at) VALUES (?, ?, ?, ?)'
);

// Helper: get action_type id by name
const getActionType = db.prepare('SELECT id FROM action_types WHERE name = ?');
const getDelegate   = db.prepare('SELECT id FROM delegates WHERE name = ?');

const atId = name => getActionType.get(name).id;
const dlId = name => getDelegate.get(name).id;

// ── Case 1: Rivky + Whitney — scheduling conflict ─────────────────────────────
const case1 = insertCase.run({ client_id: 1, instructor_id: 1, status: 'open', created_at: '2026-05-20 09:00:00' });
const ai1 = insertActionItem.run({
  case_id: case1.lastInsertRowid,
  action_type_id: atId('FOLLOW UP WITH INSTRUCTOR'),
  delegate_id: dlId('Maria'),
  status: 'open',
  initial_note: 'Whitney missed her Monday session with Rivky. Need to confirm if she can cover Thursday instead.',
  created_at: '2026-05-20 09:05:00',
});
insertNote.run(ai1.lastInsertRowid, 'Left Whitney a voicemail. Waiting to hear back.', 'MA', '2026-05-20 10:00:00');
insertNote.run(ai1.lastInsertRowid, 'Whitney confirmed Thursday 9am works.', 'MA', '2026-05-21 11:30:00');

const ai2 = insertActionItem.run({
  case_id: case1.lastInsertRowid,
  action_type_id: atId('FOLLOW UP WITH CLIENT'),
  delegate_id: dlId('Sarede'),
  status: 'open',
  initial_note: 'Confirm Thursday reschedule with Rivky.',
  created_at: '2026-05-21 12:00:00',
});
insertNote.run(ai2.lastInsertRowid, 'Texted Rivky on WhatsApp.', 'SS', '2026-05-21 12:05:00');
insertNote.run(ai2.lastInsertRowid, 'Rivky confirmed Thursday works. Update calendar.', 'SS', '2026-05-21 14:00:00');

const ai3 = insertActionItem.run({
  case_id: case1.lastInsertRowid,
  action_type_id: atId('UPDATE CALENDAR ENTRY'),
  delegate_id: dlId('Maria'),
  status: 'open',
  initial_note: 'Move Monday session to Thursday 9am for Rivky / Whitney.',
  created_at: '2026-05-21 14:05:00',
});
insertNote.run(ai3.lastInsertRowid, 'Calendar updated. Confirmation email queued.', 'MA', '2026-05-21 15:00:00');

// ── Case 2: Leah Farkas — billing issue, PRIORITY ────────────────────────────
const case2 = insertCase.run({ client_id: 2, instructor_id: null, status: 'open', created_at: '2026-05-22 08:00:00' });
const ai4 = insertActionItem.run({
  case_id: case2.lastInsertRowid,
  action_type_id: atId('PRIORITY'),
  delegate_id: dlId('Sarede'),
  status: 'open',
  initial_note: "Leah's payment bounced for May. USAePay shows insufficient funds. She has three upcoming sessions this week.",
  created_at: '2026-05-22 08:05:00',
});
insertNote.run(ai4.lastInsertRowid, 'Called Leah — no answer. Left voicemail.', 'SS', '2026-05-22 09:00:00');
insertNote.run(ai4.lastInsertRowid, 'Leah called back. Said she switched bank accounts. Will update info today.', 'SS', '2026-05-22 11:00:00');
insertNote.run(ai4.lastInsertRowid, 'Still no update in USAePay as of EOD.', 'MA', '2026-05-23 17:00:00');

const ai5 = insertActionItem.run({
  case_id: case2.lastInsertRowid,
  action_type_id: atId('UPDATE USAEPAY'),
  delegate_id: dlId('Maria'),
  status: 'open',
  initial_note: "Update Leah's payment method once she provides new card info.",
  created_at: '2026-05-22 08:10:00',
});

// ── Case 3: Miri Singer — new package setup ───────────────────────────────────
const case3 = insertCase.run({ client_id: 3, instructor_id: 2, status: 'open', created_at: '2026-05-26 10:00:00' });
const ai6 = insertActionItem.run({
  case_id: case3.lastInsertRowid,
  action_type_id: atId('SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL'),
  delegate_id: dlId('Claire'),
  status: 'open',
  initial_note: 'Miri wants to add a Wednesday session with David. Set up recurring 8am slot starting June 4.',
  created_at: '2026-05-26 10:05:00',
});
insertNote.run(ai6.lastInsertRowid, "Checked David's availability — Wednesday 8am is open.", 'CM', '2026-05-26 10:30:00');
insertNote.run(ai6.lastInsertRowid, 'Calendar event created. Drafting confirmation email.', 'CM', '2026-05-26 11:00:00');

const ai7 = insertActionItem.run({
  case_id: case3.lastInsertRowid,
  action_type_id: atId('UPDATE JOTFORM'),
  delegate_id: dlId('Maria'),
  status: 'open',
  initial_note: "Update Miri's session package on Jotform from 2x/week to 3x/week.",
  created_at: '2026-05-26 11:10:00',
});
insertNote.run(ai7.lastInsertRowid, 'Updated Jotform. Screenshot saved to client folder.', 'MA', '2026-05-27 09:00:00');

// ── Case 4: David Ostrevsky away — inform clients ─────────────────────────────
const case4 = insertCase.run({ client_id: null, instructor_id: 2, status: 'open', created_at: '2026-05-28 08:00:00' });
const ai8 = insertActionItem.run({
  case_id: case4.lastInsertRowid,
  action_type_id: atId('INSTRUCTOR AWAY - INFORM ALL CLIENTS'),
  delegate_id: dlId('Sarede'),
  status: 'open',
  initial_note: 'David is away June 9–13. Need to notify Miri and Ephraim and arrange coverage or cancellations.',
  created_at: '2026-05-28 08:05:00',
});
insertNote.run(ai8.lastInsertRowid, 'Sent WhatsApp to Miri explaining David is away that week.', 'SS', '2026-05-28 09:00:00');
insertNote.run(ai8.lastInsertRowid, 'Miri wants to reschedule, not cancel. Working on finding sub.', 'SS', '2026-05-28 10:00:00');
insertNote.run(ai8.lastInsertRowid, 'Ephraim confirmed cancellation for that week. No makeup needed.', 'MA', '2026-05-29 09:30:00');

const ai9 = insertActionItem.run({
  case_id: case4.lastInsertRowid,
  action_type_id: atId('FOLLOW UP WITH INSTRUCTOR'),
  delegate_id: dlId('Maria'),
  status: 'open',
  initial_note: 'Check with David if Sharon can cover his Miri sessions June 9–13.',
  created_at: '2026-05-28 10:05:00',
});
insertNote.run(ai9.lastInsertRowid, 'David said Sharon should be fine. Need to confirm with Sharon directly.', 'MA', '2026-05-29 11:00:00');

console.log('✅ Database seeded successfully.');
db.close();
