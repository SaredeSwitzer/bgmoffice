const express = require('express');
const db      = require('../db');

const router = express.Router();

const INTAKE_BY_INITIALS = { Sarede: 'S', Lyra: 'L', Claire: 'C' };

// Map the verbose form question labels to short keys
const FIELD_MAP = {
  'Intake done by':                                                         'intake_by',
  'New or Past Client':                                                     'new_or_past',
  'Male or Female client?':                                                 'gender',
  'Client NAME (Verify Spelling)\nIf it\'s an organization, include\na. Contact Name \nb. The name of the Organization.\n(Always create entry for new clients you input into here including contact name if relevant in Hubspot if not there already)': 'client_name',
  'Who referred them to us?':                                               'referral',
  'PHONE #\n1.Can we text them at the phone number that they provided?\na. If yes proceed to no.2\nb. If not, tell them we\'ll need to have a phone number we can text, or email at best to be able to record conversations/issues/requests/received for follow up. If only email - put the  email address-say we can\'t proceed without a number for text or email.\n2. Save their contact info in google voice after phone call! Client label!': 'phone',
  'Class STYLE':                                                            'style',
  'NEIGHBORHOOD':                                                           'neighborhood',
  'ADDRESS\n1. Put full address with City -State- and Zipcode \n2. Ask if there\'s an apt #\n3.. Building code/bell number? ': 'address',
  '# OF PARTICIPANTS & AGES':                                               'participants',
  'RATE CHARGING CLIENT/PAYMENT METHOD and COST/PRICING\n\nGo over this with them before getting other info below to make sure they want to go through with it.\n(This is for Brooklyn and other parts of non-upstate NYC neighborhoods. Most common are Williamsburg, Crown Heights and Borough Park)\nOngoing classes:\n$95/class for one person\n$120 for up to 3 people\n$150 for 4-5 and then an extra $10 per person\n\nMale Instructor rate (all styles) or request for YAEL KRICHELY Williamsburg, Crown Heights and Borough Park $125 for 1, $130 for 2 and then additional $10 for each extra person\n\nPrivate (1on1) Specialty class pricing (Scoliosis/surgery recovery etc)\nOngoing classes: $125\n\nOne time class up to 5 participants:\n$150 and then an additional $10 per extra person\n\nWeek by week class request that aren\'t ongoing:\n$125 for one person and then $150 for up to 4 people and then $10 for each additional person\n\nIf ask for discount for 2 or 3x per week, say you need to get back to them and ask me.\nLowest possible price per class: $90/class for up to 3 people (if negotiating. If ask for less say need to speak to Sarede and ask me).\n\nUPSTATE PRICING\n(Woodburne, South Fallsburg, Monticello, Swan Lake, Staten Island, New Jersey - might be others. Ask Sarede if you aren\'t sure)\n$120/class for one to 2 people\n$150 per class of 3 to 5 people an additional $10 per person\nNo packages for upstate, nor special pricing for 2x per week unless by approval from Sarede.\n\nAdd the price you discussed below': 'client_rate',
  'Notes \n1. Goals for classes? \n2. Other info (if any - injuries, health issues etc) \n3.Do you have equipment at home?(Weights? Mats?blocks? etc) \n4.Do you prefer a Male or Female instructor? Or doesn\'t matter at all?': 'notes',
  'TIME\n1.Preferred Schedule (Days + Times)\n2.Any flexibility re their availability if needed? Earliest start time? Latest start time? \n3.Start Date? *': 'time_slot',
  'Has the Client waiver been signed? Y/N?\n*\nYES (No further actions required)\nNo - ask where we can send it - Text or Email - if email ask for email\nClient waiver:\n http://www.bringthegymtome.com/clientwaiver.html\n\n"It is very important that you sign the client waiver -without it we won\'t be able to start setting up the instructor for you"\n(Go over basics with them over the phone)\n1. 24 hour cancelation policy\n2. No exchanging contact info with instructors - all schedule changes need to be done through us \n3.Ask them how best to send them the waiver to sign - do they have wifi on their phone for text? email better? or if not, have them fill out from instructor\'s phone? 4.Inform them that it typically takes us about a week to set up an instructor to set their expectations around this and that we will text or call them once we have someone for them. \n\nAfter discussing, note below where you sent the link - text or email': 'waiver',
  'Potential Instructor/s and Rate (add during call if requested for specific instructor, or if you think of an instructor that can do the class)\nAsk for CC Details: "In order for us to proceed in setting up this class, we\'ll need a credit card info on file. Rest assured that this is for completing your profile for us to start working on the class- we only charge the card once the class has been done. And accounting usually charges either Thursdays or Fridays for the classes done for the week"\n1. CC number\n2. Expiration date\n3. CVC\n\n(If past client, still get them to give cc# unless they had classes with us pretty recently in which case ask them if the card we have on file for them is still good) *': 'instructor_info',
  'Is class confirmed?Did they provide cc info?': 'confirmed',
  'Have you Pasted it?': null, // intentionally ignored
};

function mapRow(namedValues) {
  const f = {};
  for (const [label, key] of Object.entries(FIELD_MAP)) {
    if (!key) continue;
    // namedValues from Apps Script is { label: [value] }
    const val = namedValues[label];
    f[key] = Array.isArray(val) ? (val[0] || '') : (val || '');
  }
  return f;
}

// POST /api/recruiting/intake
// Called by Google Apps Script on form submit. No JWT — protected by shared secret.
router.post('/intake', (req, res) => {
  const secret = process.env.GOOGLE_FORMS_WEBHOOK_SECRET;
  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const raw = req.body;
  // Support both direct JSON payload and Apps Script namedValues wrapper
  const namedValues = raw.namedValues || raw;

  const f = mapRow(namedValues);

  // Build class_notes by concatenating several fields
  const noteLines = [];
  if (f.new_or_past)  noteLines.push(`New/Past client: ${f.new_or_past}`);
  if (f.gender)       noteLines.push(`Gender: ${f.gender}`);
  if (f.referral)     noteLines.push(`Referred by: ${f.referral}`);
  if (f.notes)        noteLines.push(f.notes);
  if (f.waiver && !/^YES/i.test(f.waiver)) noteLines.push(`Waiver: ${f.waiver}`);
  if (f.confirmed)    noteLines.push(`Confirmed/CC: ${f.confirmed}`);
  const class_notes = noteLines.filter(Boolean).join('\n\n') || null;

  const waiver_signed = /^YES/i.test(f.waiver) ? 1 : 0;
  const created_by    = INTAKE_BY_INITIALS[f.intake_by] || f.intake_by || 'FORM';

  try {
    const result = db.prepare(`
      INSERT INTO recruiting_entries
        (day_of_week, time_slot, neighborhood, style, participants,
         client_name, address, phone, waiver_signed,
         instructor_info, client_rate, class_notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'Flexible',
      f.time_slot       || null,
      f.neighborhood    || null,
      f.style           || null,
      f.participants    || null,
      f.client_name     || null,
      f.address         || null,
      f.phone           || null,
      waiver_signed,
      f.instructor_info || null,
      f.client_rate     || null,
      class_notes,
      created_by,
    );

    res.status(201).json({ id: result.lastInsertRowid, ok: true });
  } catch (err) {
    console.error('[intake webhook] DB error:', err.message);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

module.exports = router;
