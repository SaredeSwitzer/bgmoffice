/**
 * PhoneLink — renders a phone number as two clickable buttons:
 *   1. tel: link  → opens the native dialer / FaceTime
 *   2. Google Voice → opens https://voice.google.com/calls?a=nc&num=…
 *
 * Usage:  <PhoneLink phone="917-846-6723" />
 */
export default function PhoneLink({ phone }) {
  if (!phone) return null

  // Strip everything except digits, then build E.164 for US numbers
  const digits = phone.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`
  const gvUrl = `https://voice.google.com/calls?a=nc&num=${encodeURIComponent(e164)}`

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {/* Native dialer */}
      <a
        href={`tel:${e164}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-50 text-green-800 text-sm font-medium hover:bg-green-100 transition-colors border border-green-200"
        title="Call with native dialer"
      >
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
        </svg>
        {phone}
      </a>

      {/* Google Voice */}
      <a
        href={gvUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 transition-colors border border-blue-200"
        title="Call with Google Voice"
      >
        {/* Google-coloured dot grid to suggest "Google" */}
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle cx="5"  cy="5"  r="3" fill="#4285F4"/>
          <circle cx="19" cy="5"  r="3" fill="#EA4335"/>
          <circle cx="5"  cy="19" r="3" fill="#34A853"/>
          <circle cx="19" cy="19" r="3" fill="#FBBC05"/>
        </svg>
        GV
      </a>
    </span>
  )
}
