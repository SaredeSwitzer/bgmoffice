// Mirror of server/lib/places.js — see the reasoning there.
const STATE_NAMES = {
  'new york': 'NY', ny: 'NY',
  'new jersey': 'NJ', nj: 'NJ',
  connecticut: 'CT', ct: 'CT',
  pennsylvania: 'PA', pa: 'PA',
  florida: 'FL', fl: 'FL',
  california: 'CA', ca: 'CA',
  maryland: 'MD', md: 'MD',
  massachusetts: 'MA', ma: 'MA',
}

export function normalizeState(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  return STATE_NAMES[s.toLowerCase()] || s.toUpperCase().slice(0, 2)
}

// A neighborhood field holds a comma-separated list — most instructors travel to several.
export function splitAreas(value) {
  return String(value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export const STATE_LABELS = {
  NY: 'New York', NJ: 'New Jersey', CT: 'Connecticut', PA: 'Pennsylvania',
  FL: 'Florida', CA: 'California', MD: 'Maryland', MA: 'Massachusetts',
}

export function stateLabel(code) {
  return STATE_LABELS[code] || code
}
