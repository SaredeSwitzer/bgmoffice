const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Upload storage ────────────────────────────────────────────────────────────

const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/server/data/uploads'
  : path.join(__dirname, '..', 'db', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const rand = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInstructorRow(id, isAdmin) {
  const row = db.prepare('SELECT * FROM instructors WHERE id = ?').get(id);
  if (!row) return null;
  // SSN visible to all staff
  row.documents = db.prepare(
    'SELECT * FROM instructor_documents WHERE instructor_id = ? ORDER BY uploaded_at ASC'
  ).all(id);
  return row;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

// List instructors (no SSN, no documents in list view)
router.get('/', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(
      'SELECT id, name, phone, email, specialties, photo_url FROM instructors WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR specialties LIKE ? ORDER BY name'
    ).all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT id, name, phone, email, specialties, photo_url FROM instructors ORDER BY name').all();
  }
  res.json(rows);
});

// Get single instructor
router.get('/:id', (req, res) => {
  const row = getInstructorRow(req.params.id, true);
  if (!row) return res.status(404).json({ error: 'Instructor not found' });
  res.json(row);
});

// Create instructor
router.post('/', (req, res) => {
  const {
    name, phone, email, specialties, style, notes, pay_rate,
    mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare(`
    INSERT INTO instructors
      (name, phone, email, specialties, style, notes, pay_rate,
       mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    phone             || null,
    email             || null,
    specialties       || null,
    style             || null,
    notes             || null,
    pay_rate          || null,
    mailing_address   || null,
    ssn || null,
    contract_signed   ? 1 : 0,
    contract_signed_date || null,
    neighborhood      || null,
    styles_taught     || null,
  );
  res.status(201).json(getInstructorRow(result.lastInsertRowid, true));
});

// Update instructor (text fields only)
router.put('/:id', (req, res) => {
  const inst = db.prepare('SELECT id FROM instructors WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Instructor not found' });

  const {
    name, phone, email, specialties, style, notes, pay_rate,
    mailing_address, ssn, contract_signed, contract_signed_date, neighborhood, styles_taught,
  } = req.body;

  db.prepare(`
    UPDATE instructors SET name=?, phone=?, email=?, specialties=?, style=?, notes=?, pay_rate=?,
      mailing_address=?, ssn=?, contract_signed=?, contract_signed_date=?, neighborhood=?, styles_taught=?
    WHERE id=?
  `).run(
    name, phone || null, email || null, specialties || null, style || null,
    notes || null, pay_rate || null, mailing_address || null,
    ssn || null, contract_signed ? 1 : 0, contract_signed_date || null,
    neighborhood || null, styles_taught || null,
    req.params.id,
  );
  res.json(getInstructorRow(req.params.id, true));
});

// Delete instructor
router.delete('/:id', (req, res) => {
  const inst = db.prepare('SELECT id FROM instructors WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Instructor not found' });
  db.prepare('DELETE FROM instructors WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Photo upload ──────────────────────────────────────────────────────────────

router.post('/:id/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const inst = db.prepare('SELECT photo_url FROM instructors WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Instructor not found' });

  // Delete old photo file if it exists
  if (inst.photo_url) {
    const old = path.join(UPLOADS_DIR, inst.photo_url);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  db.prepare('UPDATE instructors SET photo_url=? WHERE id=?').run(req.file.filename, req.params.id);
  res.json({ photo_url: req.file.filename });
});

// ── Documents ─────────────────────────────────────────────────────────────────

router.get('/:id/documents', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM instructor_documents WHERE instructor_id = ? ORDER BY uploaded_at ASC'
  ).all(req.params.id));
});

router.post('/:id/documents', upload.single('document'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const result = db.prepare(
    'INSERT INTO instructor_documents (instructor_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.file.filename, req.file.originalname, req.user.initials);
  res.status(201).json(
    db.prepare('SELECT * FROM instructor_documents WHERE id = ?').get(result.lastInsertRowid)
  );
});

router.delete('/:id/documents/:docId', (req, res) => {
  const doc = db.prepare(
    'SELECT * FROM instructor_documents WHERE id = ? AND instructor_id = ?'
  ).get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const filePath = path.join(UPLOADS_DIR, doc.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM instructor_documents WHERE id = ?').run(req.params.docId);
  res.json({ success: true });
});

module.exports = router;
