const pool = require('../db/pg');

// Taking on a new class: one set of questions, two ways in.
//
// The questions have always lived in a Google Form that posts here as a webhook
// (server/routes/recruitingIntake.js). Staff can now answer the same questions inside the
// app instead (Recruiting → Client Intake). Both land here so the two can't drift apart —
// the same answers have to produce the same records either way.
//
// One intake writes to two places:
//   • the client — who they are, where they are, what they pay, who sent them
//   • the recruiting entry — the class we now have to staff
// linked to each other, so the entry opens onto a real profile instead of a name in a box.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The free-text schedule field often also names a *start date* ("start next Monday"),
// which can introduce a second weekday and make a clearly-recurring class look ambiguous.
// Recurring class days are usually written as plurals ("Tuesdays"), so prefer a lone
// plural day before falling back to a lone singular mention. Only commit to a day when
// exactly one candidate remains.
function detectDayOfWeek(timeSlot) {
  if (!timeSlot) return 'Flexible';
  const plural = WEEKDAYS.filter(day => new RegExp(`\\b${day}s\\b`, 'i').test(timeSlot));
  if (plural.length === 1) return plural[0];
  const singular = WEEKDAYS.filter(day => new RegExp(`\\b${day}\\b`, 'i').test(timeSlot));
  return singular.length === 1 ? singular[0] : 'Flexible';
}

// Answers that have no column of their own on the entry. Kept as the note the next person
// reads, in the order the form asks them.
function composeEntryNotes(f) {
  const lines = [];
  if (f.new_or_past) lines.push(`New/Past client: ${f.new_or_past}`);
  if (f.gender)      lines.push(`Gender: ${f.gender}`);
  if (f.referral)    lines.push(`Referred by: ${f.referral}`);
  if (f.notes)       lines.push(f.notes);
  if (f.waiver && !/^YES/i.test(f.waiver)) lines.push(`Waiver: ${f.waiver}`);
  if (f.confirmed)   lines.push(`Confirmed/CC: ${f.confirmed}`);
  return lines.filter(Boolean).join('\n\n') || null;
}

const isYes = v => /^YES/i.test(String(v || ''));

// Fill blanks on an existing client, never overwrite. An intake is a phone call being
// typed up; the profile may already hold a better-checked version of the same fact, and
// silently replacing it is how a corrected phone number goes missing.
async function fillBlanksOnClient(clientId, f) {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (!client) return null;

  const candidates = {
    phone:          f.phone,
    street:         f.address,
    neighborhood:   f.neighborhood,
    rate_per_class: f.client_rate,
    default_style:  f.style,
    referred_by:    f.referral,
    gender:         f.gender,
  };
  const fill = Object.entries(candidates)
    .filter(([col, val]) => val && !String(client[col] ?? '').trim());

  if (fill.length) {
    const sets = fill.map(([col], i) => `${col} = $${i + 1}`);
    await pool.query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = $${fill.length + 1}`,
      [...fill.map(([, val]) => val), clientId]
    );
  }
  // A signed waiver is new information; an unsigned one says nothing we didn't know.
  if (isYes(f.waiver) && !client.waiver_signed) {
    await pool.query(
      `UPDATE clients SET waiver_signed = 1, waiver_signed_date = COALESCE(waiver_signed_date, to_char(NOW(),'YYYY-MM-DD'))
        WHERE id = $1`, [clientId]
    );
  }
  const { rows: [updated] } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  return { client: updated, filled: fill.map(([col]) => col) };
}

async function createClientFromIntake(f) {
  const { rows: [client] } = await pool.query(
    `INSERT INTO clients (name, phone, street, neighborhood, rate_per_class, default_style,
                          default_participants, referred_by, gender, waiver_signed, waiver_signed_date,
                          client_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'individual') RETURNING *`,
    [
      f.client_name.trim(), f.phone || null, f.address || null, f.neighborhood || null,
      f.client_rate || null, f.style || null,
      Number.isInteger(Number(f.participants)) && f.participants !== '' ? Number(f.participants) : null,
      f.referral || null, f.gender || null,
      isYes(f.waiver) ? 1 : 0, isYes(f.waiver) ? new Date().toISOString().slice(0, 10) : null,
    ]
  );
  return client;
}

// f: the answers, in the field names the Google Form maps to (see FIELD_PREFIXES in
// server/routes/recruitingIntake.js) — client_name, phone, style, neighborhood, address,
// participants, client_rate, time_slot, notes, waiver, instructor_info, confirmed,
// new_or_past, gender, referral.
//
// opts.clientId     — an existing client this intake is about (the "past client" case)
// opts.createClient — make a profile for a client we don't have yet
// opts.preferredDays— [{ day, time }] from the in-app form; the webhook has only free text
async function recordIntake(f, { clientId = null, createClient = false, preferredDays = null,
                                 createdBy = 'FORM', instructorId = null, classType = null,
                                 classDates = null } = {}) {
  let client = null;
  let filled = [];

  if (clientId) {
    const out = await fillBlanksOnClient(clientId, f);
    client = out?.client || null;
    filled = out?.filled || [];
  } else if (createClient && f.client_name?.trim()) {
    client = await createClientFromIntake(f);
  }

  const days = Array.isArray(preferredDays) ? preferredDays.filter(d => d?.day) : [];
  const day_of_week = days.length === 1 ? days[0].day
    : days.length > 1 ? 'Flexible'
    : detectDayOfWeek(f.time_slot);
  const time_slot = f.time_slot || (days.length === 1 ? days[0].time : null) || null;

  const { rows: [entry] } = await pool.query(
    `INSERT INTO recruiting_entries
       (day_of_week, time_slot, neighborhood, style, participants,
        client_name, client_id, address, phone, waiver_signed,
        instructor_info, instructor_id, client_rate, class_notes, class_type, class_dates,
        preferred_days, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [
      day_of_week, time_slot, f.neighborhood || null, f.style || null, f.participants || null,
      client?.name || f.client_name || null, client?.id || null, f.address || null, f.phone || null,
      isYes(f.waiver) ? 1 : 0,
      f.instructor_info || null, instructorId || null, f.client_rate || null,
      composeEntryNotes(f), classType || null, classDates || null,
      days.length ? JSON.stringify(days) : null,
      createdBy,
    ]
  );

  return { entry, client, filled_on_client: filled };
}

module.exports = {
  recordIntake, detectDayOfWeek, composeEntryNotes, fillBlanksOnClient, createClientFromIntake,
};
