const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
const { syncMentions, deleteMentions } = require('../lib/mentions');

const router = express.Router();
router.use(requireAuth);

const LAST_CLASS_REMINDER_LEAD_DAYS = 7;

// Keeps the "ask about next semester" reminder in sync with a client's last-class date —
// not every client uses this (most run indefinitely with no defined end), so it's opt-in
// per client via track_last_class. Creates/updates/removes the one linked reminder rather
// than leaving a new one behind every time the date changes.
async function syncLastClassReminder(client, initials) {
  if (!client.track_last_class || !client.last_class_date) {
    if (client.last_class_reminder_id) {
      await pool.query('DELETE FROM reminders WHERE id = $1', [client.last_class_reminder_id]);
      await pool.query('UPDATE clients SET last_class_reminder_id = NULL WHERE id = $1', [client.id]);
    }
    return;
  }

  const remindOn = new Date(client.last_class_date + 'T12:00:00');
  remindOn.setDate(remindOn.getDate() - LAST_CLASS_REMINDER_LEAD_DAYS);
  const remindOnStr = remindOn.toISOString().slice(0, 10);
  const title = `Ask ${client.name} about next semester`;
  const notes = `Last class on file is ${client.last_class_date}. Reach out to find out when we should follow up about scheduling, if they haven't told us already.`;

  if (client.last_class_reminder_id) {
    await pool.query(
      `UPDATE reminders SET title=$1, notes=$2, remind_on=$3, updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$4`,
      [title, notes, remindOnStr, client.last_class_reminder_id]
    );
  } else {
    const { rows: [reminder] } = await pool.query(
      `INSERT INTO reminders (title, notes, remind_on, client_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [title, notes, remindOnStr, client.id, initials]
    );
    await pool.query('UPDATE clients SET last_class_reminder_id = $1 WHERE id = $2', [reminder.id, client.id]);
  }
}

router.get('/', async (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    const like = `%${q}%`;
    ({ rows } = await pool.query(
      'SELECT * FROM clients WHERE name ILIKE $1 OR phone ILIKE $2 OR email ILIKE $3 ORDER BY name',
      [like, like, like]
    ));
  } else {
    ({ rows } = await pool.query('SELECT * FROM clients ORDER BY name'));
  }
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { rows: prefs } = await pool.query(
    `SELECT cip.*, i.name AS instructor_name
     FROM client_instructor_prefs cip
     JOIN instructors i ON i.id = cip.instructor_id
     WHERE cip.client_id = $1`,
    [req.params.id]
  );
  // Referrals in both directions: who sent them to us (clickable when it's another
  // client), and who they've sent us since — the payoff for recording it at intake.
  const { rows: [referrer] } = client.referred_by_client_id
    ? await pool.query('SELECT id, name FROM clients WHERE id = $1', [client.referred_by_client_id])
    : { rows: [null] };
  const { rows: referred } = await pool.query(
    'SELECT id, name FROM clients WHERE referred_by_client_id = $1 ORDER BY name', [req.params.id]
  );

  res.json({
    ...client, prefs,
    referred_by_client_name: referrer?.name || null,
    referred_clients: referred,
  });
});

router.post('/', async (req, res) => {
  const {
    name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
    contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
    waiver_signed, waiver_signed_date, street, city, state, zip, neighborhood, client_type,
    default_age, default_participants, default_style,
    track_last_class, last_class_date, skip_weekly_reminder,
    referred_by, gender, referred_by_client_id, goals, health_notes, equipment,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  // If this organization already signed the contract in-app before being added as a
  // client (see clientContract.js), carry that signature + contact info over.
  let signedFlag = waiver_signed ? 1 : 0;
  let signedDate = waiver_signed_date || null;
  let signatureToLink = null;
  let sig = null;
  const matchEmail = email || contact_person_email;
  if (matchEmail) {
    ({ rows: [sig] } = await pool.query(
      `SELECT id, signed_at, contact_name, phone, street, city, zip FROM client_contract_signatures
        WHERE email = $1 AND signed_at IS NOT NULL AND client_id IS NULL
        ORDER BY signed_at DESC LIMIT 1`,
      [matchEmail]
    ));
    if (sig) { signedFlag = 1; signedDate = sig.signed_at ? new Date(sig.signed_at).toISOString().slice(0, 10) : null; signatureToLink = sig.id; }
  }

  const { rows: [client] } = await pool.query(
    `INSERT INTO clients
       (name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
        contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
        waiver_signed, waiver_signed_date, street, city, state, zip, neighborhood, client_type,
        default_age, default_participants, default_style,
        track_last_class, last_class_date, skip_weekly_reminder, referred_by, gender,
        referred_by_client_id, goals, health_notes, equipment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     RETURNING *`,
    [
      name, phone || null, email || null, invoice_email || null, preferred_contact || null,
      notes || null, rate_per_class || null,
      contact_person_name || (sig?.contact_name ?? null), contact_person_phone || (sig?.phone ?? null),
      contact_person_email || null, contact_person_role || null,
      signedFlag, signedDate,
      street || (sig?.street ?? null), city || (sig?.city ?? null), state || null, zip || (sig?.zip ?? null), neighborhood || null,
      client_type === 'organization' ? 'organization' : 'individual',
      default_age || null, default_participants === '' ? null : default_participants ?? null, default_style || null,
      !!track_last_class, last_class_date || null, !!skip_weekly_reminder,
      referred_by || null, gender || null, referred_by_client_id || null,
      goals || null, health_notes || null, equipment || null,
    ]
  );
  if (signatureToLink) {
    await pool.query('UPDATE client_contract_signatures SET client_id = $1 WHERE id = $2', [client.id, signatureToLink]);
  }
  await syncMentions({
    sourceTable: 'client_notes', sourceId: client.id, text: notes || '',
    authorInitials: req.user.initials, linkPath: `/clients/${client.id}`,
  });
  res.status(201).json(client);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query(
    `SELECT id, skip_weekly_reminder, referred_by, gender, referred_by_client_id,
            goals, health_notes, equipment FROM clients WHERE id = $1`,
    [req.params.id]
  );
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const {
    name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
    contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
    waiver_signed, waiver_signed_date, street, city, state, zip, neighborhood, client_type,
    track_last_class, last_class_date, default_age, default_participants, default_style,
    skip_weekly_reminder, referred_by, gender, referred_by_client_id,
    goals, health_notes, equipment,
  } = req.body;

  // PUT replaces the whole record, so an omitted field would silently clear it. This flag
  // isn't on every form that saves a client, so absent has to mean "leave it alone" —
  // otherwise saving a client's phone number would quietly re-enable reminder texts for
  // someone who asked not to get them. Same trap as tax_id_type on instructors.
  const nextSkipWeekly = skip_weekly_reminder === undefined || skip_weekly_reminder === null
    ? !!existing.skip_weekly_reminder
    : !!skip_weekly_reminder;

  // Same absent-means-leave-alone rule as skip_weekly_reminder: these two come from the
  // intake form and the general client edit form doesn't send them, so a plain save must
  // not wipe them. Sent-but-empty still clears, which is how you correct a wrong answer.
  const nextReferredBy = referred_by === undefined ? existing.referred_by : (referred_by || null);
  const nextGender     = gender     === undefined ? existing.gender     : (gender     || null);
  const nextReferrerId = referred_by_client_id === undefined
    ? existing.referred_by_client_id
    : (referred_by_client_id || null);
  const nextGoals     = goals        === undefined ? existing.goals        : (goals        || null);
  const nextHealth    = health_notes === undefined ? existing.health_notes : (health_notes || null);
  const nextEquipment = equipment    === undefined ? existing.equipment    : (equipment    || null);

  const { rows: [client] } = await pool.query(
    `UPDATE clients SET
       referred_by=$27, gender=$28, referred_by_client_id=$29,
       goals=$30, health_notes=$31, equipment=$32,
       name=$1, phone=$2, email=$3, invoice_email=$4, preferred_contact=$5, notes=$6, rate_per_class=$7,
       contact_person_name=$8, contact_person_phone=$9, contact_person_email=$10, contact_person_role=$11,
       waiver_signed=$12, waiver_signed_date=$13, street=$14, city=$15, state=$16, zip=$17, neighborhood=$18,
       client_type=$19, track_last_class=$20, last_class_date=$21,
       default_age=$22, default_participants=$23, default_style=$24,
       skip_weekly_reminder=$25
     WHERE id=$26 RETURNING *`,
    [
      name, phone || null, email || null, invoice_email || null, preferred_contact || null,
      notes || null, rate_per_class || null,
      contact_person_name || null, contact_person_phone || null,
      contact_person_email || null, contact_person_role || null,
      waiver_signed ? 1 : 0, waiver_signed_date || null,
      street || null, city || null, state || null, zip || null, neighborhood || null,
      client_type === 'organization' ? 'organization' : 'individual',
      !!track_last_class, last_class_date || null,
      default_age || null, default_participants === '' ? null : default_participants ?? null, default_style || null,
      nextSkipWeekly,
      req.params.id,
      nextReferredBy, nextGender, nextReferrerId,
      nextGoals, nextHealth, nextEquipment,
    ]
  );
  await syncMentions({
    sourceTable: 'client_notes', sourceId: client.id, text: notes || '',
    authorInitials: req.user.initials, linkPath: `/clients/${client.id}`,
  });
  await syncLastClassReminder(client, req.user.initials);
  const { rows: [fresh] } = await pool.query('SELECT * FROM clients WHERE id = $1', [client.id]);
  res.json(fresh);
});

// Partial update — only touches whichever of these fields are actually present in the
// body, so an address-only save (e.g. from the Schedule page) can't accidentally blank
// out invoice_email or vice versa. Full-record edits still go through PUT above.
// ── Addresses ─────────────────────────────────────────────────────────────────
// Some clients are taught in more than one place — a Brooklyn home and an upstate house.
// The primary address is mirrored back onto the client row so invoices, confirmation
// emails and every existing screen keep reading the single address they always have.

async function syncPrimaryToClient(clientId) {
  const { rows: [primary] } = await pool.query(
    `SELECT street, city, state, zip, neighborhood FROM client_addresses
      WHERE client_id = $1 AND is_primary LIMIT 1`,
    [clientId]
  );
  if (!primary) return;
  await pool.query(
    `UPDATE clients SET street=$1, city=$2, state=$3, zip=$4, neighborhood=$5 WHERE id=$6`,
    [primary.street, primary.city, primary.state, primary.zip, primary.neighborhood, clientId]
  );
}

router.get('/:id/addresses', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM client_addresses WHERE client_id = $1 ORDER BY is_primary DESC, label`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/addresses', async (req, res) => {
  const { label, street, city, state, zip, neighborhood, notes, is_primary } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Give the address a label, e.g. "Brooklyn"' });

  // The first address a client gets is their primary whether or not anyone said so —
  // otherwise a client can end up with addresses and no default for classes to use.
  const { rows: [{ count }] } = await pool.query(
    'SELECT count(*)::int AS count FROM client_addresses WHERE client_id = $1', [req.params.id]
  );
  const primary = !!is_primary || count === 0;
  if (primary) {
    await pool.query('UPDATE client_addresses SET is_primary = false WHERE client_id = $1', [req.params.id]);
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO client_addresses (client_id, label, street, city, state, zip, neighborhood, notes, is_primary, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.params.id, label.trim(), street || null, city || null, state || null, zip || null,
     neighborhood || null, notes || null, primary, req.user.initials]
  );
  if (primary) await syncPrimaryToClient(req.params.id);
  res.status(201).json(row);
});

router.put('/:id/addresses/:addressId', async (req, res) => {
  const { label, street, city, state, zip, neighborhood, notes } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Give the address a label, e.g. "Brooklyn"' });
  const { rows: [row] } = await pool.query(
    `UPDATE client_addresses
        SET label=$1, street=$2, city=$3, state=$4, zip=$5, neighborhood=$6, notes=$7
      WHERE id=$8 AND client_id=$9 RETURNING *`,
    [label.trim(), street || null, city || null, state || null, zip || null,
     neighborhood || null, notes || null, req.params.addressId, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Address not found' });
  if (row.is_primary) await syncPrimaryToClient(req.params.id);
  res.json(row);
});

router.patch('/:id/addresses/:addressId/primary', async (req, res) => {
  await pool.query('UPDATE client_addresses SET is_primary = false WHERE client_id = $1', [req.params.id]);
  const { rows: [row] } = await pool.query(
    'UPDATE client_addresses SET is_primary = true WHERE id = $1 AND client_id = $2 RETURNING *',
    [req.params.addressId, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Address not found' });
  await syncPrimaryToClient(req.params.id);
  res.json(row);
});

router.delete('/:id/addresses/:addressId', async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT is_primary FROM client_addresses WHERE id = $1 AND client_id = $2',
    [req.params.addressId, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Address not found' });

  // Classes pointing at it fall back to the primary rather than losing their address
  // entirely — that's what the null address_id means.
  await pool.query('DELETE FROM client_addresses WHERE id = $1', [req.params.addressId]);

  // Deleting the primary would leave the client with no default, so the oldest
  // remaining address takes over.
  if (row.is_primary) {
    const { rows: [next] } = await pool.query(
      'SELECT id FROM client_addresses WHERE client_id = $1 ORDER BY created_at LIMIT 1', [req.params.id]
    );
    if (next) {
      await pool.query('UPDATE client_addresses SET is_primary = true WHERE id = $1', [next.id]);
      await syncPrimaryToClient(req.params.id);
    }
  }
  res.json({ success: true });
});

const PATCHABLE_FIELDS = ['invoice_email', 'street', 'city', 'state', 'zip', 'neighborhood'];

router.patch('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const fields = PATCHABLE_FIELDS.filter(f => f in req.body);
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  const setClause = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
  const values = fields.map(f => req.body[f] || null);
  await pool.query(`UPDATE clients SET ${setClause} WHERE id=$${fields.length + 1}`, [...values, req.params.id]);

  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  res.json(client);
});

router.delete('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  await deleteMentions('client_notes', req.params.id);
  await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/prefs', async (req, res) => {
  const { instructor_id, preference, reason } = req.body;
  if (!instructor_id || !preference) return res.status(400).json({ error: 'instructor_id and preference required' });

  await pool.query(
    'DELETE FROM client_instructor_prefs WHERE client_id = $1 AND instructor_id = $2',
    [req.params.id, instructor_id]
  );
  const { rows: [pref] } = await pool.query(
    'INSERT INTO client_instructor_prefs (client_id, instructor_id, preference, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.id, instructor_id, preference, reason || null, req.user.initials]
  );
  res.status(201).json(pref);
});

router.delete('/:id/prefs/:prefId', async (req, res) => {
  await pool.query(
    'DELETE FROM client_instructor_prefs WHERE id = $1 AND client_id = $2',
    [req.params.prefId, req.params.id]
  );
  res.json({ success: true });
});

module.exports = router;
