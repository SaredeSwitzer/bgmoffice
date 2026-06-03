/**
 * PhoneLink — renders a phone number as a tappable tel: link that opens
 * the device's default phone dialer.
 *
 * Usage:  <PhoneLink phone="917-846-6723" />
 */
export default function PhoneLink({ phone }) {
  if (!phone) return null

  const digits = phone.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith('1') && digits.length === 11 ? `+${digits}` : `+${digits}`

  return (
    <a
      href={`tel:${e164}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-50 text-green-800 text-sm font-medium hover:bg-green-100 active:bg-green-200 transition-colors border border-green-200"
    >
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
      </svg>
      {phone}
    </a>
  )
}
