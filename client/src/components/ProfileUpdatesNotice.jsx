import { Link } from 'react-router-dom'

// What a class just filled in on a profile.
//
// Details typed on a class are copied onto the client's and the instructor's profile
// whenever the profile has nothing in that field (server/lib/profileBackfill.js). That
// is only helpful if the person who typed it is told — otherwise the app is editing
// records behind their back, and a rate that landed in the wrong place would go
// unnoticed. So it says what it filled in and links straight there to correct it.
function list(items) {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// The check-in reminder is set automatically the first time a client is put with an
// instructor they have not had before, so this is the only place it is announced. Same
// reasoning as above: the app should not quietly add things to My Tasks.
export default function ProfileUpdatesNotice({ updates, checkIn, onDismiss }) {
  if ((!updates || updates.length === 0) && !checkIn) return null
  return (
    <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-start justify-between gap-3">
      <div className="text-sm text-emerald-900">
        {checkIn && (
          <p>
            Added a reminder to <Link to="/my-tasks" className="font-semibold underline hover:no-underline">My Tasks</Link>
            {' '}to check in after the first class — they haven't had this instructor before.
          </p>
        )}
        {(updates || []).map(u => (
          <p key={`${u.kind}-${u.id}`}>
            Also saved to{' '}
            <Link to={`/${u.kind === 'client' ? 'clients' : 'instructors'}/${u.id}`}
              className="font-semibold underline hover:no-underline">{u.name}'s profile</Link>{`, which had no ${list(u.filled)}.`}
          </p>
        ))}
      </div>
      <button type="button" onClick={onDismiss}
        className="text-emerald-500 hover:text-emerald-800 text-lg leading-none shrink-0">×</button>
    </div>
  )
}
