// Whether we may record an outgoing call to this number without telling them.
//
// New York is a one-party-consent state: our own staff being on the call is consent
// enough, which is why outgoing calls are recorded with no announcement. That rule is
// about where the OTHER person is, though, not where we are — and roughly a dozen people
// in the book have numbers in states that require everyone on the call to agree.
//
// So those numbers are simply not recorded. The alternative was announcing it to them,
// which means a recorded-message preamble on calls to a handful of instructors we speak to
// constantly. Not recording a few calls costs less than that, and far less than recording
// one we shouldn't have.
//
// An area code is a rough proxy for where somebody is — people keep numbers when they
// move. It is the only signal we have, and it errs toward not recording, which is the
// safe direction to err in.

// Area codes in states that require all parties to consent.
const ALL_PARTY_AREA_CODES = new Set([
  // California
  '209', '213', '279', '310', '323', '341', '350', '408', '415', '424', '442', '510',
  '530', '559', '562', '619', '626', '628', '629', '650', '657', '661', '669', '707',
  '714', '747', '760', '805', '818', '820', '831', '840', '858', '909', '916', '925',
  '949', '951',
  // Pennsylvania
  '215', '223', '267', '272', '412', '445', '484', '570', '582', '610', '717', '724',
  '814', '835', '878',
  // Florida
  '239', '305', '321', '324', '352', '386', '407', '448', '561', '656', '689', '727',
  '754', '772', '786', '813', '850', '863', '904', '941', '954',
  // Washington
  '206', '253', '360', '425', '509', '564',
  // Maryland
  '227', '240', '301', '410', '443', '667',
  // Massachusetts
  '339', '351', '413', '508', '617', '774', '781', '857', '978',
  // Connecticut
  '203', '475', '860', '959',
  // Illinois
  '217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '730', '773',
  '779', '815', '847', '872',
  // Michigan, Montana, Nevada, New Hampshire, Oregon, Delaware
  '231', '248', '269', '313', '517', '586', '616', '679', '734', '810', '906', '947', '989',
  '406', '702', '725', '775', '603', '458', '503', '541', '971', '302',
]);

function mayRecordWithoutTelling(number) {
  const digits = String(number || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return false;   // unknown shape: don't record
  return !ALL_PARTY_AREA_CODES.has(digits.slice(0, 3));
}

module.exports = { mayRecordWithoutTelling };
