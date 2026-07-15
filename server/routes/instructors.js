const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const pool     = require('../db/pg');
const { requireAuth } = require('../middleware/auth');
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
  return { ...row, documents, feedback_notes };
}

router.get('/', async (req, res) => {
  const { q } = req.query;
  // Include styles_taught + neighborhood so the directory can filter/display by
  // "what they teach" and "where they're based" (searchable instructor directory).
  const cols = 'id, name, phone, email, specialties, styles_taught, neighborhood, pay_rate, photo_url';
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

router.get('/:id', async (req, res) => {
  const row = await getInstructorRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Instructor not found' });
  res.json(row);
});

router.post('/', async (req, res) => {
  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows: [inst] } = await pool.query(
    `INSERT INTO instructors (name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, ssn || null, contract_signed ? 1 : 0, contract_signed_date || null, neighborhood || null, styles_taught || null]
  );
  res.status(201).json(await getInstructorRow(inst.id));
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM instructors WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Instructor not found' });
  const { name, phone, email, specialties, style, notes, pay_rate, mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught } = req.body;
  await pool.query(
    `UPDATE instructors SET name=$1, phone=$2, email=$3, specialties=$4, style=$5, notes=$6, pay_rate=$7,
       mailing_address=$8, ssn=$9, contract_signed=$10, contract_signed_date=$11, neighborhood=$12, styles_taught=$13
     WHERE id=$14`,
    [name, phone || null, email || null, specialties || null, style || null, notes || null, pay_rate || null, mailing_address || null, ssn || null, contract_signed ? 1 : 0, contract_signed_date || null, neighborhood || null, styles_taught || null, req.params.id]
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
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows: [inst] } = await pool.query('SELECT photo_url FROM instructors WHERE id = $1', [req.params.id]);
  if (!inst) return res.status(404).json({ error: 'Instructor not found' });

  if (inst.photo_url) await deleteFromStorage(inst.photo_url);

  const url = await uploadToStorage(req.file.buffer, req.file.originalname, 'photos');
  await pool.query('UPDATE instructors SET photo_url=$1 WHERE id=$2', [url, req.params.id]);
  res.json({ photo_url: url });
});

router.get('/:id/documents', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM instructor_documents WHERE instructor_id = $1 ORDER BY uploaded_at ASC',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/documents', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = await uploadToStorage(req.file.buffer, req.file.originalname, 'documents');
  const { rows: [doc] } = await pool.query(
    'INSERT INTO instructor_documents (instructor_id, filename, original_name, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, url, req.file.originalname, req.user.initials]
  );
  res.status(201).json(doc);
});

router.delete('/:id/documents/:docId', async (req, res) => {
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
