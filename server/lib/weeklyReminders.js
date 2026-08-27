const pool = require('../db/pg');

// Weekly class reminders — the run that used to live in Amber's Google Voice browser
// automation (~/git/Amber/gen_reminders_bgmoffice.mjs), rebuilt here so it survives the
// number port and so replies land in the app's Texts inbox instead of Google Voice.
//
// Rules carried over from that script, deliberately:
//   • Instructors always get one. Clients get one unless opted out or held back.
//   • One message per person listing every class that week, not one per class.
//   • Organisations are greeted by full name, individuals by first name only.
//   • A session note saying "no 24hr"/"no texting for 24 hour" holds that client's
//     reminder (some clients have asked not to be texted the day before).
// Two things did NOT carry over, on purpose: the hardcoded SKIP_CLIENTS list is now the
// clients.skip_weekly_reminder column, and the PHONE_OVERRIDE map is gone — those numbers
// were fixed on the records themselves (see migration 023).

const NO_REMINDER_NOTE = /no\s*24\s*hr|no texting for 24 hour/i;
const ORG_HINT = /center|circle|school|connections|hamaspik|senior|camp|friendship|jcc|montessori/i;

const digits = (p) => String(p || '').replace(/\D/g, '');

// The upcoming Sun–Fri week. Amber's CLAUDE.md is emphatic that the dates must come from a
// helper rather than being worked out by hand, because getting them wrong sends everyone
// the wrong schedule — same reasoning applies here.
function upcomingWeek(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Days until the next Sunday. On Sunday itself this jumps to the *next* one, matching
  // the Friday-run habit of texting for the week ahead.
  const daysToSun = (7 - d.getDay()) % 7 || 7;
  const start = new Date(d); start.setDate(d.getDate() + daysToSun);
  const end = new Date(start); end.setDate(start.getDate() + 5); // Sun..Fri
  return { start: ymd(start), end: ymd(end) };
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const [, m, day] = dateStr.split('-');
  return `${wd} ${Number(m)}/${Number(day)}`;
}

function timeLabel(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}

function rangeLabel(start, end) {
  const [, sm, sd] = start.split('-');
  const [, em, ed] = end.split('-');
  return `${Number(sm)}/${Number(sd)}–${Number(em)}/${Number(ed)}`;
}

function greetName(full) {
  const name = String(full || '').trim();
  return ORG_HINT.test(name) ? name : name.split(/\s+/)[0];
}

function buildMessage(name, lines, label) {
  return `Hi ${greetName(name)}! This is a reminder from Bring the Gym to Me of your upcoming session(s) this week (${label}):\n` +
    `${lines.join('\n')}\n` +
    `Please remember our 24-hour cancellation policy. Let us know ASAP if you notice any discrepancy in your schedule!`;
}

// Returns { start, end, label, recipients: [...], flags: [...] }.
// `flags` is what staff needs to act on by hand — someone with no number on file, or a
// client held back by a note. Amber printed these to the terminal; here they surface in
// the UI, since nobody is watching a terminal.
async function buildWeeklyReminders({ start, end } = {}) {
  const week = start && end ? { start, end } : upcomingWeek();
  const label = rangeLabel(week.start, week.end);

  const { rows: sessions } = await pool.query(
    `SELECT s.session_date::text AS session_date, s.start_time::text AS start_time, s.notes,
            c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
            c.skip_weekly_reminder,
            i.id AS instructor_id, i.name AS instructor_name, i.phone AS instructor_phone
       FROM class_sessions s
       JOIN clients c      ON c.id = s.client_id
       LEFT JOIN instructors i ON i.id = s.instructor_id
      WHERE s.session_date BETWEEN $1 AND $2 AND s.status <> 'cancelled'
      ORDER BY s.session_date, s.start_time NULLS LAST`,
    [week.start, week.end]
  );

  const instructors = new Map();
  const clients = new Map();
  const flags = [];

  for (const s of sessions) {
    const day = dayLabel(s.session_date);
    const time = timeLabel(s.start_time);

    // ── instructor side
    if (!s.instructor_id) {
      flags.push(`No instructor assigned — ${day}${time ? `, ${time}` : ''} with ${s.client_name}.`);
    } else {
      const phone = digits(s.instructor_phone);
      if (!phone) {
        flags.push(`No phone on file for ${s.instructor_name} — can't send their reminder.`);
      } else {
        if (!instructors.has(s.instructor_id)) {
          instructors.set(s.instructor_id, { kind: 'instructor', id: s.instructor_id, name: s.instructor_name, phone, lines: [] });
        }
        instructors.get(s.instructor_id).lines.push(`${day}, ${time}: with ${s.client_name}`);
      }
    }

    // ── client side
    if (s.skip_weekly_reminder) continue;
    if (NO_REMINDER_NOTE.test(s.notes || '')) {
      flags.push(`Held ${s.client_name}'s reminder for ${day} — note says "${String(s.notes).trim()}".`);
      continue;
    }
    const cPhone = digits(s.client_phone);
    if (!cPhone) {
      flags.push(`No phone on file for ${s.client_name} — can't send their reminder (${day}${time ? `, ${time}` : ''}).`);
      continue;
    }
    if (!clients.has(s.client_id)) {
      clients.set(s.client_id, { kind: 'client', id: s.client_id, name: s.client_name, phone: cPhone, lines: [] });
    }
    clients.get(s.client_id).lines.push(`${day}, ${time}: with ${s.instructor_name || 'your instructor'}`);
  }

  const recipients = [...instructors.values(), ...clients.values()]
    .map(e => ({ ...e, message: buildMessage(e.name, e.lines, label), class_count: e.lines.length }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return { ...week, label, recipients, flags };
}

module.exports = { buildWeeklyReminders, upcomingWeek };
