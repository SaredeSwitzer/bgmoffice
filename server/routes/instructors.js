const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const pool     = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { decryptSSN } = require('../lib/ssnCrypto');
const { sendMail } = require('../lib/mailer');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// "Jane Doe" -> "JD", "Cher" -> "CH" — matches the free-typed initials staff already
// enter for other accounts in Settings > Users; just derived instead of asked for here.
function deriveInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] || '').slice(0, 2).toUpperCase();
}

const router = express.Router();
router.use(requireAuth);

// Memory storage — files are uploaded to Supabase Storage, not disk
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function uploadToStorage(buffer, originalName, folder) {
  const ext      = path.extname(originalName).toLowerCase();
  const filename = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const supabase = getSupabase();
  const { error } = await supabase.storage.from('bgm-uploads').upload(filename, buffer, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/bgm-uploads/${filename}`;
}

async function deleteFromStorage(url) {
  if (!url || !url.includes('/bgm-uploads/')) return;
  const path = url.split('/bgm-uploads/')[1];
  if (!path) return;
  const supabase = getSupabase();
  await supabase.storage.from('bgm-uploads').remove([path]);
}

async function getInstructorRow(id) {
  const { rows: [row] } = await pool.query('SELECT * FROM instructors WHERE id = $1', [id]);
  if (!row) return null;
  const { rows: documents } = await pool.query(
    'SELECT * FROM instructor_documents WHERE instructor_id = $1 ORDER BY uploaded_at ASC',
    [id]
  );
  const { rows: feedback_notes } = await pool.query(
    'SELECT * FROM instructor_notes WHERE instructor_id = $1 ORDER BY created_at DESC',
    [id]
  );
  // Login status for the "has this instructor logged in yet" indicator on their
  // profile. An instructor can have no users row at all (account creation predates
  // the auto-create-on-add feature, or it failed) — that's distinct from having an
  // account but never having signed in, so we surface both states.
  const { rows: [account] } = await pool.query(
    'SELECT last_login_at FROM users WHERE instructor_id = $1 AND role = $2', [id, 'instructor']
  );
  // Never send the encrypted blob to the browser — it's useless there and shouldn't
  // leave the server. ssn_last4 is enough for routine display; see /:id/reveal-ssn for
  // the one place staff can decrypt the full number on demand.
  const { ssn_encrypted, ...rowWithoutEncrypted } = row;
  return {
    ...rowWithoutEncrypted,
    documents,
    feedback_notes,
    has_login: !!account,
    last_login_at: account?.last_login_at || null,
  };
}

router.get('/', async (req, res) => {
  const { q } = req.query;
  // Include styles_taught + neighborhood so the directory can filter/display by
  // "what they teach" and "where they're based" (searchable instructor directory).
  // pay_rate is each instructor's own business — never send it to another instructor.
  // Login status (has_login/last_login_at) is likewise staff-only — an instructor's
  // sign-in history isn't something we show their fellow instructors in the directory.
  const isStaff = req.user.role !== 'instructor';
  const cols = isStaff
    ? `i.id, i.name, i.phone, i.email, i.specialties, i.styles_taught, i.neighborhood, i.pay_rate, i.photo_url,
       (u.id IS NOT NULL) AS has_login, u.last_login_at`
    : 'i.id, i.name, i.phone, i.email, i.specialties, i.styles_taught, i.neighborhood, i.photo_url';
  const join = isStaff ? `LEFT JOIN users u ON u.instructor_id = i.id AND u.role = 'instructor'` : '';
  let rows;
  if (q) {
    const like = `%${q}%`;
    ({ rows } = await pool.query(
      `SELECT ${cols} FROM instructors i ${join}
        WHERE i.name ILIKE $1 OR i.phone ILIKE $1 OR i.email ILIKE $1
           OR i.specialties ILIKE $1 OR i.styles_taught ILIKE $1 OR i.neighborhood ILIKE $1
        ORDER BY i.name`,
      [like]
    ));
  } else {
    ({ rows } = await pool.query(`SELECT ${cols} FROM instructors i ${join} ORDER BY i.name`));
  }
  res.json(rows);
});

// Bulk email to a filtered set of instructors — e.g. everyone who hasn't logged in
// yet, or everyone teaching Zumba in a given neighborhood (filtering happens
// client-side on the directory; this just sends to whichever ids it's handed).
// Staff-only, one send per instructor so a bad email on one doesn't block the rest.
router.post('/email-blast', requireStaff, async (req, res) => {
  const { instructor_ids, subject, body } = req.body;
  if (!Array.isArray(instructor_ids) || instructor_ids.length === 0) {
    return res.status(400).json({ error: 'instructor_ids required' });
  }
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Subject and body are required' });
  }

  const { rows: instructorsToEmail } = await pool.query(
    'SELECT id, name, email FROM instructors WHERE id = ANY($1)', [instructor_ids]
  );

  const sent = [];
  const skipped = [];
  const failed = [];
  for (const inst of instructorsToEmail) {
    if (!inst.email) { skipped.push({ id: inst.id, name: inst.name, reason: 'No email on file' }); continue; }
    try {
      const filledBody = body.replace(/\{name\}/g, inst.name.trim() || 'there');
      const filledSubject = subject.replace(/\{name\}/g, inst.name.trim() || 'there');
      await sendMail({ to: inst.email, subject: filledSubject, text: filledBody });
      sent.push({ id: inst.id, name: inst.name, email: inst.email });
    } catch (e) {
      failed.push({ id: inst.id, name: inst.name, reason: e.message });
    }
  }
  res.json({ sent, skipped, failed });
});

// Instructor accounts may only ever touch their own record — never another instructor's.
function ownRecordOrForbidden(req, res) {
  if (req.user.role !== 'instructor') return true;
  if (Number(req.params.id) === Number(req.user.instructor_id)) return true;
  res.status(403).json({ error: "Not your profile" });
  return false;
}

router.get('/:id', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const row = await getInstructorRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Instructor not found' });
  // Self-view: hide SSN and staff's internal feedback notes about them.
  if (req.user.role === 'instructor') {
    const { ssn, feedback_notes, ...safe } = row;
    return res.json(safe);
  }
  res.json(row);
});

// Nudge an instructor who has a login account but has never signed in — same email
// "how to log in" info as the welcome email, just re-sendable any time from their
// profile. Staff review/edit the filled-in preview before it sends (same pattern as
// the welcome email and class confirmations).
async function buildLoginReminderPreview(id) {
  const { rows: [inst] } = await pool.query('SELECT name, email FROM instructors WHERE id = $1', [id]);
  if (!inst) return { error: 'Instructor not found', status: 404 };
  const { rows: [account] } = await pool.query(
    "SELECT id FROM users WHERE instructor_id = $1 AND role = 'instructor'", [id]
  );
  if (!account) return { error: 'This instructor has no login account yet.', status: 400 };

  const { rows: settingsRows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('instructor_login_reminder_subject','instructor_login_reminder_body')"
  );
  const m = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const fillName = inst.name.trim() || 'there';
  const fill = (str) => (str || '').replace(/\{name\}/g, fillName).replace(/\{email\}/g, inst.email || '');
  return {
    to: inst.email || null,
    instructor_name: inst.name,
    subject: fill(m.instructor_login_reminder_subject || 'Reminder: log into your BGM Office account'),
    body: fill(m.instructor_login_reminder_body || `Hi {name},\n\nJust a reminder to log into bgmoffice.com with this email address — we'll send you a one-time code, no password needed.`),
  };
}

router.get('/:id/login-reminder-preview', requireStaff, async (req, res) => {
  const r = await buildLoginReminderPreview(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/:id/send-login-reminder', requireStaff, async (req, res) => {
  const r = await buildLoginReminderPreview(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file.' });
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
});

// Decrypts the full SSN on demand (e.g. for filing a 1099) — staff-only (same access
// level staff already had to the legacy plaintext ssn column), and separate from the
// routine GET /:id so the plaintext number only ever exists in a response when someone
// deliberately asks for it.
router.get('/:id/reveal-ssn', requireStaff, async (req, res) => {
  const { rows: [row] } = await pool.query('SELECT ssn, ssn_encrypted FROM instructors WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Instructor not found' });
  if (row.ssn_encrypted) return res.json({ ssn: decryptSSN(row.ssn_encrypted) });
  if (row.ssn) return res.json({ ssn: row.ssn });
  return res.status(404).json({ error: 'No SSN on file' });
});

router.post('/', async (req, res) => {
  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, state, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  // If this person already signed the contract in-app before being added as an instructor
  // (see instructorContract.js), carry that signature over instead of starting blank.
  let signedFlag = contract_signed ? 1 : 0;
  let signedDate = contract_signed_date || null;
  let signatureToLink = null;
  let sigSsnEncrypted = null;
  let sigSsnLast4 = null;
  if (email) {
    const { rows: [sig] } = await pool.query(
      `SELECT id, signed_at, ssn_encrypted, ssn_last4 FROM instructor_contract_signatures
        WHERE email = $1 AND signed_at IS NOT NULL AND instructor_id IS NULL
        ORDER BY signed_at DESC LIMIT 1`,
      [email]
    );
    if (sig) {
      signedFlag = 1; signedDate = sig.signed_at; signatureToLink = sig.id;
      sigSsnEncrypted = sig.ssn_encrypted; sigSsnLast4 = sig.ssn_last4;
    }
  }

  const { rows: [inst] } = await pool.query(
    `INSERT INTO instructors (name, phone, email, specialties, style, notes, pay_rate, mailing_address, state, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle, ssn_encrypted, ssn_last4)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, state || null, ssn || null, signedFlag, signedDate, neighborhood || null, styles_taught || null, payout_method || null, payout_handle || null, sigSsnEncrypted, sigSsnLast4]
  );
  if (signatureToLink) {
    await pool.query('UPDATE instructor_contract_signatures SET instructor_id = $1 WHERE id = $2', [inst.id, signatureToLink]);
  }

  // Create their login account too — same INSERT shape as Settings > Users' manual "add
  // user" flow, just automatic. Password is random and never revealed; instructors sign
  // in with an emailed code (see server/routes/auth.js), not a password. Skip quietly if
  // that email is already tied to another account (e.g. a staff login) — email is unique.
  let hasLogin = false;
  if (email) {
    const { rows: [existingUser] } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!existingUser) {
      const randomPassword = crypto.randomBytes(24).toString('hex');
      await pool.query(
        `INSERT INTO users (name, initials, email, password_hash, role, instructor_id)
         VALUES ($1,$2,$3,$4,'instructor',$5)`,
        [name, deriveInitials(name), email, bcrypt.hashSync(randomPassword, 10), inst.id]
      );
      hasLogin = true;
    }
  }

  // The welcome email is no longer auto-sent — staff review/edit the preview and send
  // it themselves (see GET/POST .../intro-preview and .../send-intro below), so a typo
  // or a not-actually-ready instructor doesn't get emailed before anyone's looked at it.
  res.status(201).json({ ...(await getInstructorRow(inst.id)), has_login: hasLogin });
});

async function buildIntroPreview(id) {
  const { rows: [inst] } = await pool.query(
    'SELECT name, email, intro_email_sent_at FROM instructors WHERE id = $1', [id]
  );
  if (!inst) return { error: 'Instructor not found', status: 404 };
  const { rows: settingsRows } = await pool.query(
    "SELECT key, value FROM app_settings WHERE key IN ('instructor_intro_subject','instructor_intro_body')"
  );
  const m = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const fillName = inst.name.trim() || 'there';
  const fill = (str) => (str || '').replace(/\{name\}/g, fillName);
  return {
    to: inst.email || null,
    instructor_name: inst.name,
    subject: fill(m.instructor_intro_subject || 'Welcome to Bring the Gym to Me!'),
    body: fill(m.instructor_intro_body || `Hi {name},\n\nWelcome to the team!`),
    already_sent_at: inst.intro_email_sent_at || null,
  };
}

// Staff review the welcome email (with a chance to edit it) before it goes out —
// same preview-then-send pattern as class confirmation emails.
router.get('/:id/intro-preview', requireStaff, async (req, res) => {
  const r = await buildIntroPreview(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

router.post('/:id/send-intro', requireStaff, async (req, res) => {
  const r = await buildIntroPreview(req.params.id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.to) return res.status(400).json({ error: 'This instructor has no email on file.' });
  const subject = (req.body.subject ?? r.subject).trim();
  const body    = (req.body.body ?? r.body);
  try {
    await sendMail({ to: r.to, subject, text: body });
  } catch (e) {
    return res.status(502).json({ error: `Could not send: ${e.message}` });
  }
  await pool.query('UPDATE instructors SET intro_email_sent_at = now() WHERE id = $1', [req.params.id]);
  res.json({ ok: true, sent_to: r.to, sent_at: new Date().toISOString() });
});

router.put('/:id', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows: [existing] } = await pool.query('SELECT * FROM instructors WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Instructor not found' });

  if (req.user.role === 'instructor') {
    // Self-service: contact info, what they teach, and how they want to be paid — never
    // pay RATE, contract, name, or SSN. payout_method/handle is just "how to reach me for
    // pay" (a Venmo @handle, a phone for Zelle, etc.) — same trust level as phone/email.
    const { phone, email, mailing_address, state, neighborhood, styles_taught, specialties, payout_method, payout_handle } = req.body;
    await pool.query(
      `UPDATE instructors SET phone=$1, email=$2, mailing_address=$3, state=$4, neighborhood=$5, styles_taught=$6, specialties=$7,
         payout_method=$8, payout_handle=$9
       WHERE id=$10`,
      [phone || null, email || null, mailing_address || null, state || null, neighborhood || null, styles_taught || null, specialties || null, payout_method || null, payout_handle || null, req.params.id]
    );
    // Keep the login email in sync — instructors only ever see one "email" field and
    // shouldn't have to know their contact info and login credential are separate rows.
    if (email) {
      await pool.query('UPDATE users SET email=$1 WHERE id=$2', [email, req.user.id]);
    }
    const row = await getInstructorRow(req.params.id);
    const { ssn, feedback_notes, ...safe } = row;
    return res.json(safe);
  }

  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, state, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle } = req.body;
  await pool.query(
    `UPDATE instructors SET name=$1, phone=$2, email=$3, specialties=$4, style=$5, notes=$6, pay_rate=$7,
       mailing_address=$8, state=$9, ssn=$10, contract_signed=$11, contract_signed_date=$12, neighborhood=$13, styles_taught=$14,
       payout_method=$15, payout_handle=$16
     WHERE id=$17`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, state || null, ssn || null, contract_signed ? 1 : 0, contract_signed_date || null, neighborhood || null, styles_taught || null, payout_method || null, payout_handle || null, req.params.id]
  );
  res.json(await getInstructorRow(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM instructors WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Instructor not found' });
  await pool.query('DELETE FROM instructors WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows: [inst] } = await pool.query('SELECT photo_url FROM instructors WHERE id = $1', [req.params.id]);
  if (!inst) return res.status(404).json({ error: 'Instructor not found' });

  if (inst.photo_url) await deleteFromStorage(inst.photo_url);

  const url = await uploadToStorage(req.file.buffer, req.file.originalname, 'photos');
  await pool.query('UPDATE instructors SET photo_url=$1 WHERE id=$2', [url, req.params.id]);
  res.json({ photo_url: url });
});

router.get('/:id/documents', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows } = await pool.query(
    'SELECT * FROM instructor_documents WHERE instructor_id = $1 ORDER BY uploaded_at ASC',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/documents', upload.single('document'), async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = await uploadToStorage(req.file.buffer, req.file.originalname, 'documents');
  const { rows: [doc] } = await pool.query(
    'INSERT INTO instructor_documents (instructor_id, filename, original_name, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, url, req.file.originalname, req.user.initials]
  );
  res.status(201).json(doc);
});

router.delete('/:id/documents/:docId', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows: [doc] } = await pool.query(
    'SELECT * FROM instructor_documents WHERE id = $1 AND instructor_id = $2',
    [req.params.docId, req.params.id]
  );
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  await deleteFromStorage(doc.filename);
  await pool.query('DELETE FROM instructor_documents WHERE id = $1', [req.params.docId]);
  res.json({ success: true });
});

router.get('/:id/notes', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM instructor_notes WHERE instructor_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/notes', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const { rows: [note] } = await pool.query(
    'INSERT INTO instructor_notes (instructor_id, text, author) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, text.trim(), req.user.initials || null]
  );
  res.status(201).json(note);
});

router.delete('/:id/notes/:noteId', async (req, res) => {
  await pool.query('DELETE FROM instructor_notes WHERE id = $1 AND instructor_id = $2', [req.params.noteId, req.params.id]);
  res.json({ success: true });
});

// ── Availability (self-service) ─────────────────────────────────────────────
// Staff already have a full editor at /recruiting (server/routes/recruiting.js), reading
// every instructor's rows unscoped. These are the instructor-facing equivalent — same
// instructor_availability table, but locked to their own record via ownRecordOrForbidden,
// same as the documents/photo routes above.

router.get('/:id/availability', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows } = await pool.query(
    'SELECT * FROM instructor_availability WHERE instructor_id = $1 ORDER BY day_of_week, time_slot',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/availability', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { day_of_week, time_slot } = req.body;
  if (!day_of_week) return res.status(400).json({ error: 'day_of_week required' });
  const { rows: [row] } = await pool.query(
    'INSERT INTO instructor_availability (instructor_id, day_of_week, time_slot) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, day_of_week, time_slot || null]
  );
  res.status(201).json(row);
});

router.put('/:id/availability/:availId', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows: [existing] } = await pool.query(
    'SELECT id FROM instructor_availability WHERE id = $1 AND instructor_id = $2', [req.params.availId, req.params.id]
  );
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { day_of_week, time_slot } = req.body;
  if (!day_of_week) return res.status(400).json({ error: 'day_of_week required' });
  const { rows: [row] } = await pool.query(
    'UPDATE instructor_availability SET day_of_week = $1, time_slot = $2 WHERE id = $3 RETURNING *',
    [day_of_week, time_slot || null, req.params.availId]
  );
  res.json(row);
});

router.delete('/:id/availability/:availId', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  await pool.query('DELETE FROM instructor_availability WHERE id = $1 AND instructor_id = $2', [req.params.availId, req.params.id]);
  res.json({ success: true });
});

// Has this instructor already confirmed "still accurate" (or edited) their availability
// this week? Same shape as payout_requests/status (server/routes/payoutRequests.js).
router.get('/:id/availability-check', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { week_start } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) required' });
  const { rows: [row] } = await pool.query(
    'SELECT confirmed_at FROM availability_confirmations WHERE instructor_id = $1 AND week_start = $2',
    [req.params.id, week_start]
  );
  res.json({ confirmed: !!row, confirmed_at: row?.confirmed_at ?? null });
});

router.post('/:id/availability-check', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { week_start } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) required' });
  await pool.query(
    `INSERT INTO availability_confirmations (instructor_id, week_start, confirmed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (instructor_id, week_start) DO UPDATE SET confirmed_at = now()`,
    [req.params.id, week_start]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
