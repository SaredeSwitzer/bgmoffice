// "Send us your payment request" — the nudge for instructors who taught last week and
// haven't asked to be paid yet.
//
// Two different things are tracked and it matters which one this is built on:
//   payout_requests    — the instructor tapped the Venmo button on their own page
//   instructor_payments — Sarede's own record of whether she has actually paid them
//
// This is built on the second. Her question is "who have I not paid yet?", and an
// instructor who never touched the button but got paid in cash is not someone to chase.
// A week with no instructor_payments row at all counts as unpaid, because that is what it
// means: nobody has recorded paying them.

const pool = require('../db/pg');

// Weeks run Sunday to Saturday here, matching instructor_payments.week_start.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function previousWeek(today = new Date()) {
  const sunday = new Date(today);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());  // this week's Sunday
  const start = new Date(sunday);
  start.setDate(start.getDate() - 7);                  // last week's Sunday
  const end = new Date(start);
  end.setDate(end.getDate() + 6);                      // its Saturday
  return { start: ymd(start), end: ymd(end) };
}

function pretty(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The message itself. States what we think they're owed, because the alternative is a
// round of "how much was it?" — but says "our records" rather than asserting a figure at
// them, since their count is the one that settles it.
function buildMessage({ name, classes, amount, start, end }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const owed = Number(amount || 0);
  const forWeek = `${pretty(start)}–${pretty(end)}`;
  const worked = `${classes} ${classes === 1 ? 'class' : 'classes'}`;
  const sum = owed > 0 ? `, $${owed.toFixed(2)} by our records` : '';
  // No "This is Bring the Gym to Me" here, unlike the client-facing messages. These go to
  // instructors who work for her and know exactly who is asking; introducing ourselves to
  // our own staff every week reads like a form letter.
  return `Hi ${first}! We don't have your payment request for the week of ${forWeek} yet `
       + `(${worked}${sum}). Please send it through Venmo to @bringthegymtome when you get `
       + `a chance and we'll get you paid. Thanks!`;
}

// Everyone who taught in the given week and has not been recorded as paid for it.
async function buildPayoutReminders({ start, end } = {}) {
  const week = start && end ? { start, end } : previousWeek();

  const { rows } = await pool.query(
    `SELECT i.id,
            i.name,
            i.phone,
            i.email,
            count(*)::int                        AS classes,
            coalesce(sum(cs.instructor_pay), 0)  AS amount,
            p.status                             AS payment_status
       FROM class_sessions cs
       JOIN instructors i ON i.id = cs.instructor_id
       LEFT JOIN instructor_payments p
              ON p.instructor_id = i.id
             AND p.week_start::date = $1::date
      WHERE cs.session_date BETWEEN $1::date AND $2::date
        -- A cancelled class was not taught and is not owed for.
        AND coalesce(cs.status, '') <> 'cancelled'
        AND cs.instructor_id IS NOT NULL
        -- Not yet recorded as paid: either no record at all, or one that says unpaid.
        AND (p.id IS NULL OR p.status <> 'paid')
      GROUP BY i.id, i.name, i.phone, i.email, p.status
      ORDER BY i.name`,
    [week.start, week.end]
  );

  return {
    week,
    people: rows.map((r) => {
      const body = buildMessage({ ...r, start: week.start, end: week.end });
      const hasPhone = String(r.phone || '').replace(/\D/g, '').length >= 10;
      return {
        instructor_id: r.id,
        name: r.name,
        classes: r.classes,
        amount: Number(r.amount),
        payment_status: r.payment_status || 'no record',
        // Taught, but nothing is owed for it. Do NOT read this as a mistake: a zero is
        // often deliberate — Trippy agreed to no pay for a week as compensation for a
        // no-show. Either way there is nothing to ask them to invoice for, so they are
        // left out of the chase; whether the zero is right is Sarede's call, not ours.
        nothing_owed: Number(r.amount) <= 0,
        // Texted where possible, emailed where not — the same rule the weekly class
        // reminders follow, so nobody is silently skipped for lacking a mobile.
        channel: hasPhone ? 'sms' : (r.email ? 'email' : 'none'),
        to: hasPhone ? r.phone : (r.email || null),
        body,
        subject: 'Your payment request — Bring the Gym to Me',
      };
    }),
  };
}

module.exports = { buildPayoutReminders, previousWeek };
