// Same check the server makes (server/lib/neighborhood.js) — kept here as well so a form
// says so while you're typing instead of failing on save. The server is the one that
// actually enforces it; this is only the courtesy.
const ADDRESS_LABELS = /(street\s*address|postal\s*\/?\s*zip|zip\s*code|address\s*line\s*\d)/i
const STREET_LINE = /\b\d+\s+[\w.'’-]+(?:\s+[\w.'’-]+)*\s+(?:ave|avenue|st|street|rd|road|blvd|boulevard|ln|lane|dr|drive|pl|place|ct|court|ter|terrace|pkwy|parkway|hwy|highway|turnpike|way|cir|circle)\b\.?/i
const ZIP  = /\b\d{5}(?:-\d{4})?\b/
const UNIT = /\b(?:apt|apartment|suite|ste|unit|floor|fl)\b\.?\s*#?\s*\w+/i

export function looksLikeAddress(value) {
  const s = String(value ?? '').trim()
  if (!s) return false
  return ADDRESS_LABELS.test(s) || STREET_LINE.test(s) || ZIP.test(s) || UNIT.test(s)
}

export const NEIGHBORHOOD_HELP =
  'That looks like a street address. Neighborhood is just the area — e.g. Sheepshead Bay.'

// The warning that sits under a neighborhood box. Renders nothing when the value is fine.
export function NeighborhoodWarning({ value }) {
  if (!looksLikeAddress(value)) return null
  return <p className="text-[11px] text-amber-700 mt-1">{NEIGHBORHOOD_HELP}</p>
}
