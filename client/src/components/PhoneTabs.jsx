import { NavLink } from 'react-router-dom'
import { useUnreadTexts } from '../context/UnreadTextsContext'

// Texts and calls are one thing, not two.
//
// They are the same conversation with the same person on the same number — a client
// texts, then rings, then leaves a message, and splitting that across two top-level tabs
// made it look like two separate relationships. One heading in the bar, two tabs inside.
//
// Kept as two routes rather than one merged list for now: the two read differently (a
// thread you reply into vs. a log you scan), and collapsing them into a single timeline
// is a bigger change than tidying the bar.

export default function PhoneTabs({ voicemailCount = 0 }) {
  const { unread } = useUnreadTexts()

  const cls = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-gray-100 p-1">
      <NavLink to="/sms" className={cls}>
        Texts{unread > 0 ? ` (${unread})` : ''}
      </NavLink>
      <NavLink to="/calls" className={cls}>
        Calls{voicemailCount > 0 ? ` (${voicemailCount})` : ''}
      </NavLink>
    </div>
  )
}
