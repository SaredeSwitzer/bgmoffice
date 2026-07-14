const express = require('express');
const pool    = require('../db/pg');

const router = express.Router();

const INTAKE_BY_INITIALS = { Sarede: 'S', Lyra: 'L', Claire: 'C' };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function detectDayOfWeek(timeSlot) {
  if (!timeSlot) return 'Flexible';
  const mentioned = WEEKDAYS.filter(day => new RegExp(day, 'i').test(timeSlot));
  return mentioned.length === 1 ? mentioned[0] : 'Flexible';
}

// Match on a short, stable prefix rather than the full label text — the live
// Google Form's long instructional labels drift slightly over time (edits to
// the paragraph body), which broke exact-string matching.
const FIELD_PREFIXES = [
  ['Intake done by',           'intake_by'],
  ['New or Past Client',       'new_or_past'],
  ['Male or Female client?',   'gender'],
  ['Client NAME',              'client_name'],
  ['Who referred them to us?', 'referral'],
  ['PHONE #',                  'phone'],
  ['Class STYLE',              'style'],
  ['NEIGHBORHOOD',             'neighborhood'],
  ['ADDRESS',                  'address'],
  ['# OF PARTICIPANTS',        'participants'],
  ['RATE CHARGING CLIENT',     'client_rate'],
  ['Notes',                    'notes'],
  ['TIME',                     'time_slot'],
  ['Has the Client waiver been signed', 'waiver'],
  ['Potential Instructor',     'instructor_info'],
  ['Is class confirmed',       'confirmed'],
  ['Have you Pasted it?',      null],
];

function mapRow(namedValues) {
  const f = {};
  for (const [label, val] of Object.entries(namedValues)) {
    const trimmedLabel = label.trim();
    const match = FIELD_PREFIXES.find(([prefix]) => trimmedLabel.startsWith(prefix));
    if (!match || !match[1]) continue;
    const key = match[1];
    f[key] = Array.isArray(val) ? (val[0] || '') : (val || '');
  }
  return f;
}

router.post('/intake', async (req, res) => {
  const secret   = process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const raw = req.body;
  const namedValues = raw.namedValues || raw;
  const f = mapRow(namedValues);

  const noteLines = [];
  if (f.new_or_past) noteLines.push(`New/Past client: ${f.new_or_past}`);
  if (f.gender)      noteLines.push(`Gender: ${f.gender}`);
  if (f.referral)    noteLines.push(`Referred by: ${f.referral}`);
  if (f.notes)       noteLines.push(f.notes);
  if (f.waiver && !/^YES/i.test(f.waiver)) noteLines.push(`Waiver: ${f.waiver}`);
  if (f.confirmed)   noteLines.push(`Confirmed/CC: ${f.confirmed}`);
  const class_notes = noteLines.filter(Boolean).join('\n\n') || null;
  const waiver_signed = /^YES/i.test(f.waiver) ? 1 : 0;
  const created_by    = INTAKE_BY_INITIALS[f.intake_by] || f.intake_by || 'FORM';

  try {
    const { rows: [entry] } = await pool.query(
      `INSERT INTO recruiting_entries
         (day_of_week, time_slot, neighborhood, style, participants,
          client_name, address, phone, waiver_signed,
          instructor_info, client_rate, class_notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        detectDayOfWeek(f.time_slot), f.time_slot || null, f.neighborhood || null, f.style || null, f.participants || null,
        f.client_name || null, f.address || null, f.phone || null, waiver_signed,
        f.instructor_info || null, f.client_rate || null, class_notes, created_by,
      ]
    );
    res.status(201).json({ id: entry.id, ok: true });
  } catch (err) {
    console.error('[intake webhook] DB error:', err.message);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

module.exports = router;
