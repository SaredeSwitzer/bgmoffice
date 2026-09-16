import { ClientLink, InstructorLink } from './NameLink'
import { renderWithMentions } from '../utils/mentions.jsx'
import { authorLabel } from '../utils/author'
import { noteTime } from '../utils/dates'

// Mentions, shaped like what they are.
//
// They used to sit in the same table as tasks, under Client / Instructor / Age / Note
// columns. But a task is a job with a subject, and a mention is a person saying something
// to you — so the two things that matter, who tagged you and what they said, ended up as
// the smallest text on the row, while the Client and Instructor columns sat empty (plenty
// of mentions hang off a Waiting On line with no client at all). The message itself was
// clipped at about 260px, so the one part carrying meaning was the part you couldn't read.
//
// Here each one is a short message: who, when, what it is about, and the whole thing.

// "MA" means nothing to the person reading their own list; "Maria" does. Office staff only
// — instructors have logins too and their initials collide, so an unmatched or ambiguous
// set stays as initials rather than guessing a name.
function whoWrote(initials, users) {
  const raw = String(initials || '')
  if (!raw) return 'Someone'
  const hits = users.filter(u => String(u.initials || '').toUpperCase() === raw.toUpperCase())
  return hits.length === 1 ? hits[0].name : authorLabel(raw)
}

function Avatar({ initials }) {
  return (
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[11px] font-bold text-purple-700">
      {String(initials || '?').slice(0, 3).toUpperCase()}
    </span>
  )
}

export default function MentionList({ items, users = [], onOpen, onResolve, onToggleUrgent, isNew }) {
  return (
    <ul className="space-y-2">
      {items.map((m) => {
        const fresh = isNew?.(m)
        const who = whoWrote(m.last_note?.author_initials, users)
        const text = m.last_note?.text || ''
        return (
          <li
            key={m.id}
            onClick={() => onOpen(m)}
            className={`cursor-pointer rounded-xl border px-3 py-2.5 transition-colors ${
              m.starred ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
              : fresh    ? 'border-blue-200 bg-blue-50/50 hover:bg-blue-50'
              :            'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <Avatar initials={m.last_note?.author_initials} />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm ${fresh ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                    {who}
                  </span>
                  <span className="text-[11px] text-gray-400">{noteTime(m.created_at)}</span>
                </div>

                {/* Where it came from. The client and instructor are still links, they
                    just stop being columns that are empty most of the time. */}
                {(m.about || m.client_name || m.instructor_name) && (
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {m.about && <span className="italic">{m.about}</span>}
                    {m.about && (m.client_name || m.instructor_name) && <span> · </span>}
                    {m.client_name && <ClientLink id={m.client_id} name={m.client_name} stopPropagation />}
                    {m.client_name && m.instructor_name && <span> · </span>}
                    {m.instructor_name && <InstructorLink id={m.instructor_id} name={m.instructor_name} stopPropagation />}
                  </p>
                )}

                {/* The whole message, wrapped rather than clipped. This is the part
                    somebody actually needs to read. */}
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-snug text-gray-800">
                  {text ? renderWithMentions(text, users, { clientId: m.client_id, instructorId: m.instructor_id }) : <span className="italic text-gray-400">Tagged you, with no message.</span>}
                </p>

                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(m) }}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onResolve(m) }}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-green-300 hover:bg-green-50 hover:text-green-700"
                  >
                    Done ✓
                  </button>
                </div>
              </div>

              {/* Urgent, the same star as everywhere else on this page. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleUrgent(m) }}
                title={m.starred ? 'Not urgent' : 'Mark urgent'}
                className={`shrink-0 text-base leading-none ${
                  m.starred ? 'text-red-500' : 'text-gray-200 hover:text-red-300'}`}
              >★</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
