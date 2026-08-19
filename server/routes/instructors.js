const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const pool     = require('../db/pg');
const { requireAuth, requireStaff } = require('../middleware/auth');
const { decryptSSN } = require('../lib/ssnCrypto');
const { createClient } = require('@supabase/supabase-js');

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
  // Never send the encrypted blob to the browser — it's useless there and shouldn't
  // leave the server. ssn_last4 is enough for routine display; see /:id/reveal-ssn for
  // the one place staff can decrypt the full number on demand.
  const { ssn_encrypted, ...rowWithoutEncrypted } = row;
  return { ...rowWithoutEncrypted, documents, feedback_notes };
}

router.get('/', async (req, res) => {
  const { q } = req.query;
  // Include styles_taught + neighborhood so the directory can filter/display by
  // "what they teach" and "where they're based" (searchable instructor directory).
  // pay_rate is each instructor's own business — never send it to another instructor.
  const cols = req.user.role === 'instructor'
    ? 'id, name, phone, email, specialties, styles_taught, neighborhood, photo_url'
    : 'id, name, phone, email, specialties, styles_taught, neighborhood, pay_rate, photo_url';
  let rows;
  if (q) {
    const like = `%${q}%`;
    ({ rows } = await pool.query(
      `SELECT ${cols} FROM instructors
        WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1
           OR specialties ILIKE $1 OR styles_taught ILIKE $1 OR neighborhood ILIKE $1
        ORDER BY name`,
      [like]
    ));
  } else {
    ({ rows } = await pool.query(`SELECT ${cols} FROM instructors ORDER BY name`));
  }
  res.json(rows);
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
  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle } = req.body;
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
    `INSERT INTO instructors (name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle, ssn_encrypted, ssn_last4)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, ssn || null, signedFlag, signedDate, neighborhood || null, styles_taught || null, payout_method || null, payout_handle || null, sigSsnEncrypted, sigSsnLast4]
  );
  if (signatureToLink) {
    await pool.query('UPDATE instructor_contract_signatures SET instructor_id = $1 WHERE id = $2', [inst.id, signatureToLink]);
  }
  res.status(201).json(await getInstructorRow(inst.id));
});

router.put('/:id', async (req, res) => {
  if (!ownRecordOrForbidden(req, res)) return;
  const { rows: [existing] } = await pool.query('SELECT * FROM instructors WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Instructor not found' });

  if (req.user.role === 'instructor') {
    // Self-service: contact info, what they teach, and how they want to be paid — never
    // pay RATE, contract, name, or SSN. payout_method/handle is just "how to reach me for
    // pay" (a Venmo @handle, a phone for Zelle, etc.) — same trust level as phone/email.
    const { phone, email, mailing_address, neighborhood, styles_taught, specialties, payout_method, payout_handle } = req.body;
    await pool.query(
      `UPDATE instructors SET phone=$1, email=$2, mailing_address=$3, neighborhood=$4, styles_taught=$5, specialties=$6,
         payout_method=$7, payout_handle=$8
       WHERE id=$9`,
      [phone || null, email || null, mailing_address || null, neighborhood || null, styles_taught || null, specialties || null, payout_method || null, payout_handle || null, req.params.id]
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

  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught, payout_method, payout_handle } = req.body;
  await pool.query(
    `UPDATE instructors SET name=$1, phone=$2, email=$3, specialties=$4, style=$5, notes=$6, pay_rate=$7,
       mailing_address=$8, ssn=$9, contract_signed=$10, contract_signed_date=$11, neighborhood=$12, styles_taught=$13,
       payout_method=$14, payout_handle=$15
     WHERE id=$16`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, ssn || null, contract_signed ? 1 : 0, contract_signed_date || null, neighborhood || null, styles_taught || null, payout_method || null, payout_handle || null, req.params.id]
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

module.exports = router;
