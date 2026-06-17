import PhoneLink from './PhoneLink'

const CONTACT_LABELS = { text: 'Text', email: 'Email', whatsapp: 'WhatsApp', call: 'Call' }
const CONTACT_COLORS = {
  text:     'bg-sky-100 text-sky-700',
  email:    'bg-violet-100 text-violet-700',
  whatsapp: 'bg-green-100 text-green-700',
  call:     'bg-orange-100 text-orange-700',
}

export default function ContactInfo({ phone, email, preferred_contact }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {phone && (
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Phone</p>
          <PhoneLink phone={phone} />
        </div>
      )}
      {email && (
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Email</p>
          <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`}
            target="_blank" rel="noopener noreferrer"
            className="text-gray-800 hover:text-blue-600">{email}</a>
        </div>
      )}
      {preferred_contact && (
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Prefers</p>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${CONTACT_COLORS[preferred_contact] || 'bg-gray-100 text-gray-600'}`}>
            {CONTACT_LABELS[preferred_contact] || preferred_contact}
          </span>
        </div>
      )}
    </div>
  )
}
