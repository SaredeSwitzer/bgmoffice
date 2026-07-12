const express = require('express');
const pool    = require('../db/pg');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

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
  res.json({ ...client, prefs });
});

router.post('/', async (req, res) => {
  const {
    name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
    contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
    waiver_signed, waiver_signed_date, street, city, zip, neighborhood,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const { rows: [client] } = await pool.query(
    `INSERT INTO clients
       (name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
        contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
        waiver_signed, waiver_signed_date, street, city, zip, neighborhood)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      name, phone || null, email || null, invoice_email || null, preferred_contact || null,
      notes || null, rate_per_class || null,
      contact_person_name || null, contact_person_phone || null,
      contact_person_email || null, contact_person_role || null,
      waiver_signed ? 1 : 0, waiver_signed_date || null,
      street || null, city || null, zip || null, neighborhood || null,
    ]
  );
  res.status(201).json(client);
});

router.put('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const {
    name, phone, email, invoice_email, preferred_contact, notes, rate_per_class,
    contact_person_name, contact_person_phone, contact_person_email, contact_person_role,
    waiver_signed, waiver_signed_date, street, city, zip, neighborhood,
  } = req.body;

  const { rows: [client] } = await pool.query(
    `UPDATE clients SET
       name=$1, phone=$2, email=$3, invoice_email=$4, preferred_contact=$5, notes=$6, rate_per_class=$7,
       contact_person_name=$8, contact_person_phone=$9, contact_person_email=$10, contact_person_role=$11,
       waiver_signed=$12, waiver_signed_date=$13, street=$14, city=$15, zip=$16, neighborhood=$17
     WHERE id=$18 RETURNING *`,
    [
      name, phone || null, email || null, invoice_email || null, preferred_contact || null,
      notes || null, rate_per_class || null,
      contact_person_name || null, contact_person_phone || null,
      contact_person_email || null, contact_person_role || null,
      waiver_signed ? 1 : 0, waiver_signed_date || null,
      street || null, city || null, zip || null, neighborhood || null,
      req.params.id,
    ]
  );
  res.json(client);
});

router.patch('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const { invoice_email } = req.body;
  await pool.query('UPDATE clients SET invoice_email=$1 WHERE id=$2', [invoice_email || null, req.params.id]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
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
