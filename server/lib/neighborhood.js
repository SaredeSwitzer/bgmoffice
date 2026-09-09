// A neighborhood is an area — Sheepshead Bay, Park Slope, Boca Raton. It is not a street
// address, and the two fields sit next to each other on every form that asks.
//
// One instructor pasted a whole address block into the neighborhood box ("Street Address:
// 3118 Emmons Ave City: Brooklyn …"), which then showed on his profile where the area
// should be and made him unfindable by neighborhood — the one thing the field is for.
//
// So every route that stores a neighborhood checks it here first. Staff forms refuse the
// value and say what to do; the public sign-up and the intake webhook, where refusing
// would throw away what somebody typed, move it to the field it belongs in instead.

// House number followed by a street word: "3118 Emmons Ave", "42 W 8th Street".
const STREET_LINE = /\b\d+\s+[\w.'’-]+(?:\s+[\w.'’-]+)*\s+(?:ave|avenue|st|street|rd|road|blvd|boulevard|ln|lane|dr|drive|pl|place|ct|court|ter|terrace|pkwy|parkway|hwy|highway|turnpike|way|cir|circle)\b\.?/i;

// The labels a form's address widget leaves behind when it is flattened into one line.
const ADDRESS_LABELS = /(street\s*address|postal\s*\/?\s*zip|zip\s*code|address\s*line\s*\d)/i;

// A US zip, or an apartment/suite — neither belongs in an area name.
const ZIP  = /\b\d{5}(?:-\d{4})?\b/;
const UNIT = /\b(?:apt|apartment|suite|ste|unit|floor|fl)\b\.?\s*#?\s*\w+/i;

// Deliberately does NOT fire on a bare number in a real area name ("5 Towns", "Section 3"):
// it wants a street word, a zip, a unit, or a form's own address labels.
function looksLikeAddress(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  return ADDRESS_LABELS.test(s) || STREET_LINE.test(s) || ZIP.test(s) || UNIT.test(s);
}

// What staff are told when a form refuses it. Says the field's job and gives an example,
// rather than just "invalid".
const NEIGHBORHOOD_HELP =
  'That looks like a street address. Neighborhood is just the area — e.g. Sheepshead Bay. ' +
  'Put the address in the address field.';

// For routes that answer a request: returns an error response body, or null when fine.
function rejectIfAddress(value) {
  return looksLikeAddress(value) ? { error: NEIGHBORHOOD_HELP } : null;
}

module.exports = { looksLikeAddress, rejectIfAddress, NEIGHBORHOOD_HELP };
