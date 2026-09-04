import PhoneLink from './PhoneLink'
import GmailComposeLink from './GmailComposeLink'

const CONTACT_LABELS = { text: 'Text', email: 'Email', whatsapp: 'WhatsApp', call: 'Call' }
const CONTACT_COLORS = {
  text:     'bg-sky-100 text-sky-700',
  email:    'bg-violet-100 text-violet-700',
  whatsapp: 'bg-green-100 text-green-700',
  call:     'bg-orange-100 text-orange-700',
}

export default function ContactInfo({ phone, email, preferred_contact, phone_texting, phone_whatsapp }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {phone && (
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Phone</p>
          <PhoneLink phone={phone} />
          {/* Answered at intake. "No" is the one worth seeing before anybody types a
              message — a number that doesn't take texts silently swallows them. */}
          {(phone_texting || phone_whatsapp) && (
            <p className="text-[11px] mt-0.5 flex flex-wrap gap-1.5">
              {phone_texting && (
                <span className={phone_texting === 'No' ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                  {phone_texting === 'No' ? 'No texts' : 'Texts OK'}
                </span>
              )}
              {phone_whatsapp && (
                <span className={phone_whatsapp === 'No' ? 'text-gray-400' : 'text-green-700 font-semibold'}>
                  {phone_whatsapp === 'No' ? 'No WhatsApp' : 'WhatsApp'}
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {email && (
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">Email</p>
          <GmailComposeLink to={email} className="text-gray-800 hover:text-blue-600 cursor-pointer" />
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
