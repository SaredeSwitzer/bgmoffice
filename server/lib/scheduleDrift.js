// Where a recurring class and the dated classes on the calendar disagree.
//
// The two are separate records: `class_schedules` says "every Monday at 2:30 with Sharon,
// billed to a package", and `class_sessions` holds one row per actual date. Nothing keeps
// them in step, and three separate bugs have now come out of that gap — a time edit that
// never reached the calendar, a weekday change that left classes on the old day, and a
// blank payment method that stopped classes coming off a client's package.
//
// Rather than keep fixing them one at a time as they surface through billing, this makes
// the disagreements visible: what differs, on how many classes, and which value each side
// holds. It deliberately does NOT decide who is right. A difference is often intentional
// — a substitute instructor for one week, a different rate for one date — so every fix is
// something a person chooses per schedule and per field, with a preview first.

const pool = require('../db/pg');

// Only fields where "the whole class changed" is a sensible statement. session_date and
// status are per-occurrence by definition and never appear here.
const FIELDS = [
  { key: 'instructor_id',    label: 'Instructor' },
  { key: 'start_time',       label: 'Time' },
  { key: 'duration_minutes', label: 'Length' },
  { key: 'charge_amount',    label: 'Charge' },
  { key: 'instructor_pay',   label: 'Instructor pay' },
  { key: 'payment_method',   label: 'Payment method' },
  { key: 'style',            label: 'Class style' },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Values are compared as strings so 60 and '60' don't read as a difference — the columns
// come back with mixed types depending on how the row was written.
function same(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  return String(a) === String(b);
}

function display(field, value, instructorNames) {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (field === 'instructor_id') return instructorNames.get(String(value)) || `#${value}`;
  if (field === 'start_time') return String(value).slice(0, 5);
  if (field === 'charge_amount' || field === 'instructor_pay') return `$${value}`;
  if (field === 'duration_minutes') return `${value} min`;
  return String(value);
}

// One report covering every active recurring class that has future dates on the calendar.
async function findDrift() {
  const { rows: instructors } = await pool.query('SELECT id, name FROM instructors');
  const instructorNames = new Map(instructors.map(i => [String(i.id), i.name]));

  const { rows: schedules } = await pool.query(
    `SELECT sch.*, c.name AS client_name, i.name AS instructor_name
       FROM class_schedules sch
       JOIN clients c ON c.id = sch.client_id
       LEFT JOIN instructors i ON i.id = sch.instructor_id
      WHERE sch.status <> 'cancelled'
      ORDER BY c.name`
  );

  const { rows: sessions } = await pool.query(
    `SELECT s.id, s.schedule_id, s.session_date::text AS session_date,
            s.instructor_id, s.start_time::text AS start_time, s.duration_minutes,
            s.charge_amount, s.instructor_pay, s.payment_method, s.style,
            EXTRACT(DOW FROM s.session_date::date)::int AS session_weekday
       FROM class_sessions s
      WHERE s.schedule_id IS NOT NULL
        AND s.session_date >= CURRENT_DATE
        AND s.status <> 'cancelled'`
  );

  const bySchedule = new Map();
  for (const s of sessions) {
    if (!bySchedule.has(s.schedule_id)) bySchedule.set(s.schedule_id, []);
    bySchedule.get(s.schedule_id).push(s);
  }

  const report = [];
  for (const sch of schedules) {
    const mine = bySchedule.get(sch.id) || [];
    if (!mine.length) continue;

    const issues = [];
    for (const { key, label } of FIELDS) {
      const scheduleValue = key === 'start_time' && sch[key] ? String(sch[key]) : sch[key];
      const off = mine.filter(s => !same(s[key], scheduleValue));
      if (!off.length) continue;

      // Group the disagreeing classes by what they actually say, so "96 classes are at
      // 3:00" reads as one line rather than 96.
      const variants = new Map();
      for (const s of off) {
        const v = s[key] === null || s[key] === undefined ? '' : String(s[key]);
        variants.set(v, (variants.get(v) || 0) + 1);
      }
      issues.push({
        field: key,
        label,
        schedule_value: display(key, scheduleValue, instructorNames),
        affected: off.length,
        // A single big group is almost always the bug; a scatter of ones is almost
        // always deliberate. Ordering by size puts the telling one first.
        variants: [...variants.entries()]
          .map(([value, count]) => ({ value: display(key, value || null, instructorNames), count }))
          .sort((a, b) => b.count - a.count),
      });
    }

    // Classes sitting on a day this class doesn't run. Can't be patched in place — the
    // date itself is wrong — so it's reported separately with its own fix.
    const wrongDay = sch.weekday === null ? [] : mine.filter(s => s.session_weekday !== sch.weekday);
    const wrongWeekday = wrongDay.length
      ? {
          expected: DAYS[sch.weekday],
          affected: wrongDay.length,
          variants: [...wrongDay.reduce((m, s) => m.set(s.session_weekday, (m.get(s.session_weekday) || 0) + 1), new Map())]
            .map(([wd, count]) => ({ value: DAYS[wd], count }))
            .sort((a, b) => b.count - a.count),
          first: wrongDay.reduce((a, s) => (a && a < s.session_date ? a : s.session_date), null),
          last:  wrongDay.reduce((a, s) => (a && a > s.session_date ? a : s.session_date), null),
        }
      : null;

    if (!issues.length && !wrongWeekday) continue;

    report.push({
      schedule_id: sch.id,
      client_id: sch.client_id,
      client_name: sch.client_name,
      instructor_name: sch.instructor_name,
      status: sch.status,
      weekday: sch.weekday === null ? null : DAYS[sch.weekday],
      start_time: sch.start_time ? String(sch.start_time).slice(0, 5) : null,
      future_sessions: mine.length,
      issues,
      wrong_weekday: wrongWeekday,
    });
  }

  // Biggest disagreements first — those are the ones costing money.
  report.sort((a, b) => {
    const worst = r => Math.max(
      r.wrong_weekday ? r.wrong_weekday.affected : 0,
      ...r.issues.map(i => i.affected), 0
    );
    return worst(b) - worst(a);
  });

  return {
    schedules_checked: schedules.length,
    schedules_with_drift: report.length,
    report,
  };
}

// Push the recurring class's values onto its future dates, for the fields asked for only.
// Nothing happens to past classes (billing and payroll history stay as they happened) or
// cancelled ones. dryRun returns the counts without writing.
async function reconcile(scheduleId, { fields = [], fixWeekday = false, dryRun = true } = {}) {
  const { rows: [sch] } = await pool.query('SELECT * FROM class_schedules WHERE id = $1', [scheduleId]);
  if (!sch) return { error: 'Schedule not found' };

  const allowed = fields.filter(f => FIELDS.some(x => x.key === f));
  const result = { schedule_id: Number(scheduleId), dry_run: dryRun, fields: allowed, updated: 0, removed: 0, regenerated: 0 };

  if (allowed.length) {
    const sets = allowed.map((f, i) => `${f} = $${i + 1}`);
    const args = allowed.map(f => sch[f] ?? null);
    if (allowed.includes('instructor_id')) {
      sets.push('confirmation_sent_at = NULL', 'confirmation_sent_to = NULL');
    }
    sets.push('updated_at = now()');
    args.push(scheduleId);

    // The two statements can't share a WHERE clause: the update's placeholders are
    // offset by however many fields are being set, the count's are not.
    const scope = "session_date >= CURRENT_DATE AND status <> 'cancelled'";
    if (dryRun) {
      const { rows: [{ count }] } = await pool.query(
        `SELECT count(*)::int AS count FROM class_sessions WHERE schedule_id = $1 AND ${scope}`,
        [scheduleId]
      );
      result.updated = count;
    } else {
      const { rowCount } = await pool.query(
        `UPDATE class_sessions SET ${sets.join(', ')}
          WHERE schedule_id = $${args.length} AND ${scope}`,
        args
      );
      result.updated = rowCount;
    }
  }

  if (fixWeekday && sch.weekday !== null) {
    // Same placeholders either way here, so one clause serves both.
    const where = `WHERE schedule_id = $1 AND session_date >= CURRENT_DATE AND status <> 'cancelled'
                     AND EXTRACT(DOW FROM session_date::date)::int <> $2`;
    if (dryRun) {
      const { rows: [{ count }] } = await pool.query(
        `SELECT count(*)::int AS count FROM class_sessions ${where}`, [scheduleId, sch.weekday]
      );
      result.removed = count;
    } else {
      const { rowCount } = await pool.query(`DELETE FROM class_sessions ${where}`, [scheduleId, sch.weekday]);
      result.removed = rowCount;
      // Lay the series back down on the right day. Required after the delete, or the
      // client simply loses those weeks.
      const { generateUpcomingSessions, defaultHorizon } = require('./dailySync');
      const gen = await generateUpcomingSessions(defaultHorizon(), { scheduleId: Number(scheduleId) });
      result.regenerated = gen.sessions_created;
    }
  }

  return result;
}

module.exports = { findDrift, reconcile, FIELDS };
