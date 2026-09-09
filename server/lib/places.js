// Where somebody teaches, in three widening steps: state → area → neighborhood.
//
// The neighborhood list started as a flat New York list, because everyone was in New York.
// It isn't any more — there are instructors in New Jersey, Pennsylvania and Florida — and
// a single flat list of every area in every state is not something anyone can scan.
//
// So a neighborhood belongs to an area (a borough, or a region like "Long Island"), and an
// area belongs to a state. The picker shows one state's areas at a time, and the search
// narrows the same way.

// The order New York's areas are shown in — the boroughs first, since that's where nearly
// all the work is, then out. Any area not named here still shows, at the end.
const NY_AREAS = [
  'Brooklyn', 'Manhattan', 'Queens', 'Bronx', 'Staten Island',
  'Long Island', 'Westchester & Upstate', 'Other',
];

// Written a dozen ways by a dozen people — "NY", "New York", "new york ". One spelling
// wins so a search for New York finds all of them.
const STATE_NAMES = {
  'new york': 'NY', ny: 'NY',
  'new jersey': 'NJ', nj: 'NJ',
  connecticut: 'CT', ct: 'CT',
  pennsylvania: 'PA', pa: 'PA',
  florida: 'FL', fl: 'FL',
  california: 'CA', ca: 'CA',
  maryland: 'MD', md: 'MD',
  massachusetts: 'MA', ma: 'MA',
};

function normalizeState(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return STATE_NAMES[s.toLowerCase()] || s.toUpperCase().slice(0, 2);
}

// The area headings offered for a state: the canonical order for New York, and for
// anywhere else whatever areas that state already has, plus "Other" to add into.
function areasFor(state, rows = []) {
  const st = normalizeState(state);
  if (st === 'NY') return NY_AREAS;
  const existing = [...new Set(rows.filter(r => normalizeState(r.state) === st).map(r => r.region).filter(Boolean))];
  return [...existing.filter(a => a !== 'Other').sort(), 'Other'];
}

// A neighborhood field holds a comma-separated list ("Park Slope, Crown Heights"), because
// most instructors will travel to more than one.
function splitAreas(value) {
  return String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { NY_AREAS, normalizeState, areasFor, splitAreas };
