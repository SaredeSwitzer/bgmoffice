// Highlights "@Full Name" substrings in saved note text, matched against the same
// active-users list the composer autocompletes against. Mirrors the matching rules
// in server/lib/mentions.js (longest name first, case-sensitive substring).
export function renderWithMentions(text, users) {
  if (!text) return text
  const names = [...(users || [])]
    .map(u => u.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (!names.length) return text

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')

  const parts = []
  let lastIndex = 0
  let m
  while ((m = pattern.exec(text))) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    parts.push(
      <span key={m.index} className="font-semibold text-blue-700 bg-blue-50 rounded px-0.5">
        @{m[1]}
      </span>
    )
    lastIndex = m.index + m[0].length
  }
  parts.push(text.slice(lastIndex))
  return parts
}
