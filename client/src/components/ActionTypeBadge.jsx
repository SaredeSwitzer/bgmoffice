const COLOR_MAP = {
  blue:   'bg-blue-100 text-blue-800',
  green:  'bg-green-100 text-green-800',
  purple: 'bg-purple-100 text-purple-800',
  teal:   'bg-teal-100 text-teal-800',
  orange: 'bg-orange-100 text-orange-800',
  pink:   'bg-pink-100 text-pink-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  red:    'bg-red-100 text-red-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  amber:  'bg-amber-100 text-amber-800',
  slate:  'bg-slate-100 text-slate-700',
  gray:   'bg-gray-100 text-gray-700',
}

// Shortened display labels for badges
const SHORT_LABELS = {
  'FOLLOW UP WITH INSTRUCTOR':                          'FU INSTRUCTOR',
  'FOLLOW UP WITH CLIENT':                              'FU CLIENT',
  'REVIEW ISSUE WITH SAREDE':                           'REVIEW W/ SAREDE',
  'SET UP CLASS ON CALENDAR AND SEND CONFIRMATION EMAIL': 'SET UP CLASS',
  'FOLLOW UP ON BLAST RESPONSES':                       'BLAST RESPONSES',
  'ADD TO RECRUITING / SEND BLAST':                     'SEND BLAST',
  'INSTRUCTOR AWAY - INFORM ALL CLIENTS':               'INSTR AWAY',
  'UPDATE CALENDAR ENTRY':                              'UPDATE CALENDAR',
  'UPDATE USAEPAY':                                     'UPDATE USAEPAY',
  'UPDATE JOTFORM':                                     'UPDATE JOTFORM',
}

export default function ActionTypeBadge({ name, color, size = 'sm' }) {
  const cls = COLOR_MAP[color] || COLOR_MAP.gray
  const label = SHORT_LABELS[name] || name
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded font-semibold tracking-wide ${textSize} ${cls} whitespace-nowrap`}>
      {label}
    </span>
  )
}
