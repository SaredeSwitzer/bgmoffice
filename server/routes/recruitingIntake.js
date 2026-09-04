const express = require('express');
const { recordIntake } = require('../lib/clientIntake');

const router = express.Router();

const INTAKE_BY_INITIALS = { Sarede: 'S', Lyra: 'L', Claire: 'C' };

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

  const created_by = INTAKE_BY_INITIALS[f.intake_by] || f.intake_by || 'FORM';

  try {
    // Same writer the in-app intake form uses (server/lib/clientIntake.js) — the two ways
    // of answering these questions have to produce the same records. The form doesn't ask
    // which existing client this is, so a profile is only made when staff say it's new.
    const { entry } = await recordIntake(f, {
      createClient: /^NEW/i.test(f.new_or_past || ''),
      createdBy: created_by,
    });
    res.status(201).json({ id: entry.id, ok: true });
  } catch (err) {
    console.error('[intake webhook] DB error:', err.message);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

module.exports = router;
