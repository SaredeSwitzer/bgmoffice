const pool = require('../db/pg');

// Putting a name to a number.
//
// A number nobody recognises shows as "(347) 586-2328" in the inbox and in the call log,
// every time, for ever. Thirteen of those had built up. The fix is not one thing, because
// "who is this?" has three different answers:
//
//   1. Somebody already in the book whose number we never stored. The number goes ON their
//      profile, so it is recognised next time and so calling them from the client screen
//      works — the whole point of having them on file.
//   2. A new client or instructor. They get a real record, because that is what they are,
//      and everything downstream (classes, invoices, reminders) needs one.
//   3. Everyone else — someone thinking about classes, an instructor not taken on, a
//      parent, a landlord. A name and a label, nothing more. Deliberately NOT a client
//      record: a "potential client" in the clients table turns up in invoice pickers and
//      billing runs, and would eventually be charged for a class they never took.
//
// Whichever way it goes, the messages and calls already on file get the name written back
// so the history reads properly rather than only new ones.

const KINDS = ['client', 'instructor'];
const CATEGORIES = ['client', 'instructor', 'potential_client', 'potential_instructor', 'other'];

const digitsOf = v => String(v || '').replace(/\D/g, '').slice(-10);

// Everything already logged from this number gets the name — the inbox groups by number,
// so a thread would otherwise stay anonymous above and named below.
async function backfill(phone, person) {
  const digits = digitsOf(phone);
  if (digits.length !== 10) return;
  const args = [digits, person.name || null, person.kind || null, person.id || null];
  await pool.query(
    `UPDATE sms_messages
        SET person_name = $2, person_kind = $3, person_id = $4
      WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1`,
    args);
  await pool.query(
    `UPDATE voice_calls
        SET person_name = $2, person_kind = $3, person_id = $4
      WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1`,
    args);
}

// Who, if anyone, already has this number.
async function whoHasNumber(phone) {
  const digits = digitsOf(phone);
  if (digits.length !== 10) return null;
  const { rows } = await pool.query(
    `SELECT id, name, 'client' AS kind FROM clients
      WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1
     UNION ALL
     SELECT id, name, 'instructor' AS kind FROM instructors
      WHERE right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = $1
     LIMIT 1`, [digits]);
  return rows[0] || null;
}

// People whose name looks like the one being typed, so an existing record is offered
// before a duplicate is created. Duplicate instructors have been a real and repeated
// clean-up job here, so the offer comes first and the new record second.
async function suggestMatches(name) {
  const q = String(name || '').trim();
  if (q.length < 2) return [];
  const { rows } = await pool.query(
    `SELECT id, name, phone, 'client' AS kind FROM clients WHERE name ILIKE '%' || $1 || '%'
     UNION ALL
     SELECT id, name, phone, 'instructor' AS kind FROM instructors WHERE name ILIKE '%' || $1 || '%'
     ORDER BY name LIMIT 8`, [q]);
  return rows;
}

async function saveContact({ phone, name, category, link, note, initials }) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('Give them a name.'), { status: 400 });
  if (!CATEGORIES.includes(category)) {
    throw Object.assign(new Error('Pick what kind of contact this is.'), { status: 400 });
  }
  const digits = digitsOf(phone);
  if (digits.length !== 10) {
    throw Object.assign(new Error('That does not look like a phone number.'), { status: 400 });
  }

  // ── 1. Attach to somebody already on file ──
  if (link?.id && KINDS.includes(link.kind)) {
    const table = link.kind === 'client' ? 'clients' : 'instructors';
    const { rows: [person] } = await pool.query(
      `SELECT id, name, phone FROM ${table} WHERE id = $1`, [link.id]);
    if (!person) throw Object.assign(new Error('That person no longer exists.'), { status: 404 });

    // Their existing number is left alone if they have one — a second number for the same
    // person is normal (a parent's mobile, a school office), and silently replacing the
    // one every reminder goes to would be the worst kind of helpful.
    let stored = true;
    if (!String(person.phone || '').trim()) {
      await pool.query(`UPDATE ${table} SET phone = $1 WHERE id = $2`, [phone, link.id]);
    } else if (digitsOf(person.phone) !== digits) {
      stored = false;
    }
    await backfill(phone, { id: person.id, kind: link.kind, name: person.name });
    return {
      ok: true, kind: link.kind, id: person.id, name: person.name,
      linked: true, number_stored: stored,
      message: stored
        ? `Saved — texts and calls from this number now show as ${person.name}.`
        : `Linked to ${person.name}. Their profile already had a different number, so this one was left off it.`,
    };
  }

  // ── 2. A new client or instructor gets a real record ──
  if (category === 'client' || category === 'instructor') {
    const table = category === 'client' ? 'clients' : 'instructors';
    const { rows: [made] } = await pool.query(
      `INSERT INTO ${table} (name, phone) VALUES ($1,$2) RETURNING id, name`, [clean, phone]);
    await backfill(phone, { id: made.id, kind: category, name: made.name });
    return {
      ok: true, kind: category, id: made.id, name: made.name, created: true,
      message: `${made.name} added as ${category === 'instructor' ? 'an instructor' : 'a client'}, with this number on their profile.`,
    };
  }

  // ── 3. Everyone else: a name and a label ──
  const { rows: [contact] } = await pool.query(
    `INSERT INTO phone_contacts (phone, name, category, note, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10))
     DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
                   note = COALESCE(EXCLUDED.note, phone_contacts.note)
     RETURNING id, name, category`,
    [phone, clean, category, note || null, initials || null]);
  // No id or kind: they are not a client or an instructor, and pretending otherwise would
  // make their name a link to a profile that does not exist.
  await backfill(phone, { id: null, kind: null, name: contact.name });
  const label = category === 'potential_client' ? 'a potential client'
    : category === 'potential_instructor' ? 'a potential instructor' : 'a contact';
  return { ok: true, contact_id: contact.id, name: contact.name, category,
    message: `Saved ${contact.name} as ${label}.` };
}

// The name for a number that is not a client or instructor, used when a message arrives.
async function contactFor(phone) {
  const digits = digitsOf(phone);
  if (digits.length !== 10) return null;
  const { rows } = await pool.query(
    `SELECT id, name, category FROM phone_contacts
      WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 LIMIT 1`, [digits]);
  return rows[0] || null;
}

module.exports = { saveContact, suggestMatches, whoHasNumber, contactFor, CATEGORIES };
