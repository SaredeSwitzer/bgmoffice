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
//
// In practice the calendar is the record staff actually keep up, so most disagreements are
// a stale recurring class rather than a wrong calendar. Two things follow from that:
// `adopt` takes the calendar's answer and writes it back onto the recurring class (the
// opposite direction from `reconcile`), and any disagreement can be dismissed so a
// deliberate change stops being re-reported every week. A dismissal is keyed to *what*
// disagreed, not just the class — see signatureFor — so if the same field drifts to some
// new value later it surfaces again instead of staying silently hidden.

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

// Identifies a specific disagreement so a dismissal survives the ordinary passage of time
// but not an actual change. Counts are deliberately left out: the number of future classes
// falls every week as they happen, and a dismissal shouldn't pop back for that alone. The
// distinct values on each side are what matter.
function signatureFor(scheduleValue, calendarValues) {
  const side = [...new Set(calendarValues.map(v => (v === null || v === undefined ? '' : String(v))))].sort();
  const mine = scheduleValue === null || scheduleValue === undefined ? '' : String(scheduleValue);
  return `${mine}»${side.join(',')}`;
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

  const { rows: dismissals } = await pool.query(
    'SELECT schedule_id, field, signature FROM schedule_drift_dismissals'
  );
  const dismissed = new Set(dismissals.map(d => `${d.schedule_id}|${d.field}|${d.signature}`));
  const isDismissed = (scheduleId, field, signature) =>
    dismissed.has(`${scheduleId}|${field}|${signature}`);

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
      const signature = signatureFor(scheduleValue, off.map(s => s[key]));
      if (isDismissed(sch.id, key, signature)) continue;

      // Blanks aren't an answer, so they can't be copied up onto the recurring class.
      // A field where the calendar only ever disagrees by being empty has exactly one
      // sensible fix — fill the classes in from the class — and the panel should say so
      // rather than offer a button that would wipe the last good value.
      const nonBlank = off.filter(s => s[key] !== null && s[key] !== undefined && s[key] !== '');
      const blankCount = off.length - nonBlank.length;

      issues.push({
        field: key,
        label,
        signature,
        // Adoptable only when the calendar's disagreement is mostly a real answer. If it
        // is mostly emptiness — 97 classes missing a payment method and one filled in —
        // the story is a gap to be filled from the class, not a decision to copy up.
        adoptable: nonBlank.length > blankCount,
        blank_count: blankCount,
        schedule_value: display(key, scheduleValue, instructorNames),
        // The calendar's own answer, for adopting in the other direction: the value the
        // most classes agree on, which is what staff have actually been entering.
        calendar_value: display(key, [...variants.entries()]
          .sort((a, b) => b[1] - a[1])[0][0] || null, instructorNames),
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
    const weekdaySignature = wrongDay.length
      ? signatureFor(sch.weekday, wrongDay.map(s => s.session_weekday)) : null;
    const wrongWeekday = wrongDay.length && !isDismissed(sch.id, 'weekday', weekdaySignature)
      ? {
          signature: weekdaySignature,
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

// The other direction: the calendar is right, so teach the recurring class what it says.
//
// This is the common case — staff keep the calendar current and the recurring class is the
// record that goes stale — and without it the only offered fix was to overwrite the good
// data with the stale data. Nothing on the calendar is touched; only the recurring class
// changes, so the next dates it generates come out right too.
//
// The value adopted is whatever the most future classes agree on, worked out here from the
// database rather than taken from the caller, so what gets written is what is actually on
// the calendar at this moment.
async function adopt(scheduleId, { fields = [], adoptWeekday = false, dryRun = true } = {}) {
  const { rows: [sch] } = await pool.query('SELECT * FROM class_schedules WHERE id = $1', [scheduleId]);
  if (!sch) return { error: 'Schedule not found' };

  const { rows: sessions } = await pool.query(
    `SELECT instructor_id, start_time::text AS start_time, duration_minutes,
            charge_amount, instructor_pay, payment_method, style,
            EXTRACT(DOW FROM session_date::date)::int AS session_weekday
       FROM class_sessions
      WHERE schedule_id = $1 AND session_date >= CURRENT_DATE AND status <> 'cancelled'`,
    [scheduleId]
  );

  const allowed = fields.filter(f => FIELDS.some(x => x.key === f));
  const result = { schedule_id: Number(scheduleId), dry_run: dryRun, changes: {}, applied: false };
  if (!sessions.length) return result;

  // Most common wins. A tie keeps the recurring class as it is rather than picking
  // arbitrarily — a genuine 50/50 split is not something to resolve without a person.
  //
  // Blanks never vote. A missing payment method or style means nobody filled it in, not
  // that the class is meant to have none — and blank payment methods are precisely what
  // stops a class coming off a client's package. Counting them would let the commonest
  // fault on the calendar overwrite the one record that still holds the right answer.
  function majority(key) {
    const counts = new Map();
    for (const s of sessions) {
      const raw = s[key];
      if (raw === null || raw === undefined || raw === '') continue;
      const v = String(raw);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return undefined;
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined;
    return ranked[0];
  }

  const sets = [];
  const args = [];
  for (const key of allowed) {
    const top = majority(key);
    if (top === undefined) continue;
    const [value, count] = top;
    if (same(value, sch[key])) continue;
    args.push(value);
    sets.push(`${key} = $${args.length}`);
    result.changes[key] = { from: sch[key] ?? null, to: value, agreed_by: count };
  }

  if (adoptWeekday) {
    const top = majority('session_weekday');
    if (top !== undefined && !same(top[0], sch.weekday)) {
      args.push(Number(top[0]));
      sets.push(`weekday = $${args.length}`);
      result.changes.weekday = {
        from: sch.weekday === null ? null : DAYS[sch.weekday],
        to: DAYS[Number(top[0])],
        agreed_by: top[1],
      };
    }
  }

  if (!sets.length || dryRun) return result;

  sets.push('updated_at = now()');
  args.push(scheduleId);
  await pool.query(`UPDATE class_schedules SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
  result.applied = true;
  return result;
}

// Stop reporting one particular disagreement. Tied to the signature, not just the field,
// so this silences the difference that was actually looked at and nothing else.
async function dismissDrift(scheduleId, field, signature, who) {
  await pool.query(
    `INSERT INTO schedule_drift_dismissals (schedule_id, field, signature, dismissed_by)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (schedule_id, field, signature) DO NOTHING`,
    [scheduleId, field, signature, who || null]
  );
  return { success: true };
}

async function undismissDrift(scheduleId, field, signature) {
  const { rowCount } = signature
    ? await pool.query(
        'DELETE FROM schedule_drift_dismissals WHERE schedule_id=$1 AND field=$2 AND signature=$3',
        [scheduleId, field, signature])
    : await pool.query('DELETE FROM schedule_drift_dismissals WHERE schedule_id=$1', [scheduleId]);
  return { success: true, removed: rowCount };
}

// What has been hidden, so it can be shown and put back rather than lost for good.
async function listDismissed() {
  const { rows } = await pool.query(
    `SELECT d.id, d.schedule_id, d.field, d.signature, d.dismissed_by, d.dismissed_at,
            c.name AS client_name, i.name AS instructor_name
       FROM schedule_drift_dismissals d
       JOIN class_schedules sch ON sch.id = d.schedule_id
       JOIN clients c           ON c.id   = sch.client_id
       LEFT JOIN instructors i  ON i.id   = sch.instructor_id
      ORDER BY d.dismissed_at DESC`
  );
  const labelFor = f => (f === 'weekday' ? 'Day' : (FIELDS.find(x => x.key === f)?.label || f));
  return rows.map(r => ({ ...r, label: labelFor(r.field) }));
}

module.exports = { findDrift, reconcile, adopt, dismissDrift, undismissDrift, listDismissed, FIELDS };
