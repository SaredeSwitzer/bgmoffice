// "Log in / set your availability" — the nudge to instructors who aren't using BGM Office
// the way it needs them to.
//
// The app already nudges instructors about availability once they're signed in
// (client/src/components/AvailabilityNudge.jsx). That reaches nobody who never signs in,
// which is exactly who needs it most. This one goes out by text from the office side,
// preview-first like the class and payout reminders.
//
// Three buckets, one message each:
//   never_logged_in  — has a login account, has never used it
//   no_availability  — signs in, but has never listed a single day/time they can teach
//   stale            — has availability, but nothing touched or confirmed in `staleDays`
// Anyone whose availability is fresh is counted but not listed. Instructors with no login
// account at all are listed so staff can see them, but there's nothing to send.

const pool = require('../db/pg');

const DEFAULT_STALE_DAYS = 28;
// Texted about this in the last N days → shown, but unticked by default. Read off the Texts
// inbox itself (any outbound text to them mentioning bgmoffice.com) rather than a separate
// stamp, so the login instructions appended to a weekly class reminder count too.
const RECENT_NUDGE_DAYS = 10;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function first(name) {
  const s = String(name || '').trim().split(/\s+/)[0] || '';
  return s.length >= 2 ? s[0].toUpperCase() + s.slice(1).toLowerCase() : (name || 'there');
}

// Same login instructions in every message: instructors sign in with an emailed/texted
// code, and the one thing they most often get wrong is which email address to enter.
function howToLogIn(email) {
  return `go to bgmoffice.com, enter your email${email ? ` (${email})` : ''}, and we'll text/email you a one-time code — no password needed`;
}

function buildMessage(kind, { name, email }) {
  const hi = `Hi ${first(name)}!`;
  const how = howToLogIn(email);
  const How = how[0].toUpperCase() + how.slice(1);
  switch (kind) {
    case 'never_logged_in':
      return `${hi} We noticed you haven't logged into BGM Office yet. It only takes a minute: ${how}. `
           + `Once you're in you'll see your up-to-date schedule, and you can set the days and times you're available to teach. `
           + `Reply here if anything isn't working. — Bring the Gym to Me`;
    case 'no_availability':
      return `${hi} Quick ask: could you add your availability in BGM Office? ${How}. `
           + `Then open My Profile and tick the days and times you can teach. That's how we match you with new classes, so the more accurate it is, `
           + `the more we can send your way. Thanks! — Bring the Gym to Me`;
    case 'stale':
      return `${hi} It's been a while since your availability in BGM Office was updated. Could you take a minute to check it's still right? `
           + `${How}. Then open My Profile and update the days/times you can teach `
           + `(or confirm it's unchanged). Thanks! — Bring the Gym to Me`;
    default:
      return '';
  }
}

// scope: 'upcoming' — instructors with a class in the next `weeks` weeks (default), or
//        'all'      — everyone with a login account.
async function buildInstructorNudges({ scope = 'upcoming', weeks = 4, staleDays = DEFAULT_STALE_DAYS } = {}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = new Date(today); until.setDate(until.getDate() + weeks * 7);
  const window = { start: ymd(today), end: ymd(until) };

  const { rows } = await pool.query(
    `SELECT i.id, i.name, i.phone, i.email,
            (u.id IS NOT NULL)                                   AS has_login,
            u.last_login_at,
            (SELECT count(*)::int FROM instructor_availability a WHERE a.instructor_id = i.id) AS slots,
            -- created_at on instructor_availability is text; cast defensively.
            (SELECT max(NULLIF(a.created_at, '')::timestamptz) FROM instructor_availability a WHERE a.instructor_id = i.id) AS last_slot_added,
            (SELECT max(c.confirmed_at) FROM availability_confirmations c WHERE c.instructor_id = i.id) AS last_confirmed,
            (SELECT count(*)::int FROM class_sessions s
              WHERE s.instructor_id = i.id AND coalesce(s.status, '') <> 'cancelled'
                AND s.session_date BETWEEN $1::date AND $2::date)               AS upcoming_classes,
            (SELECT max(m.created_at) FROM sms_messages m
              WHERE m.direction = 'outbound' AND m.person_kind = 'instructor' AND m.person_id = i.id
                AND m.body ILIKE '%bgmoffice.com%')                                AS last_nudged_at
       FROM instructors i
       LEFT JOIN users u ON u.instructor_id = i.id AND u.role = 'instructor'
      ORDER BY i.name`,
    [window.start, window.end]
  );

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - staleDays);
  const recent = new Date(); recent.setDate(recent.getDate() - RECENT_NUDGE_DAYS);

  const people = [];
  let upToDate = 0;
  for (const r of rows) {
    if (scope === 'upcoming' ? r.upcoming_classes === 0 : !r.has_login) continue;

    let kind;
    if (!r.has_login) kind = 'no_login';
    else if (!r.last_login_at) kind = 'never_logged_in';
    else if (r.slots === 0) kind = 'no_availability';
    else {
      const touched = [r.last_slot_added, r.last_confirmed].filter(Boolean).map(d => new Date(d));
      const latest = touched.length ? new Date(Math.max(...touched)) : null;
      if (latest && latest >= cutoff) { upToDate++; continue; }
      kind = 'stale';
    }

    const hasPhone = String(r.phone || '').replace(/\D/g, '').length >= 10;
    const recentlyNudged = r.last_nudged_at && new Date(r.last_nudged_at) >= recent;
    people.push({
      instructor_id: r.id,
      name: r.name,
      kind,
      upcoming_classes: r.upcoming_classes,
      last_login_at: r.last_login_at,
      slots: r.slots,
      last_availability_at: [r.last_slot_added, r.last_confirmed].filter(Boolean).sort().pop() || null,
      last_nudged_at: r.last_nudged_at,
      recently_nudged: !!recentlyNudged,
      // Texted where possible, emailed where not — same rule as the other reminders.
      channel: kind === 'no_login' ? 'none' : hasPhone ? 'sms' : (r.email ? 'email' : 'none'),
      to: hasPhone ? r.phone : (r.email || null),
      subject: kind === 'never_logged_in' ? 'Logging into BGM Office' : 'Your availability in BGM Office',
      body: kind === 'no_login' ? '' : buildMessage(kind, r),
    });
  }

  return { scope, window, stale_days: staleDays, up_to_date: upToDate, people };
}

module.exports = { buildInstructorNudges, DEFAULT_STALE_DAYS };
