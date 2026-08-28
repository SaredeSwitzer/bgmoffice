import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import WaitingOnSection from './WaitingOnSection'

// The same "Waiting to Hear Back From" list that lives on the Clients and Instructors
// tabs, surfaced where people actually start their day — the Dashboard and My Tasks —
// and split so it's obvious which side of the business is owed a reply.
//
// Deliberately the SAME WaitingOnSection component rather than a read-only copy: the
// point of putting it here is to work the list, not just look at it. Adding, resolving
// and note-taking behave identically wherever it appears, and there's one implementation
// to keep correct.
export default function WaitingOnOverview({ collapsible = false, defaultOpen = true }) {
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [mentionableUsers, setMentionableUsers] = useState([])
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    // Failures are swallowed on purpose — these only populate the "who are you waiting
    // on?" picker. If a list doesn't load, the section still renders and stays usable.
    api.getClients().then(cs => setClients(cs.map(c => ({ id: c.id, name: c.name })))).catch(() => {})
    api.getInstructors().then(is => setInstructors(is.map(i => ({ id: i.id, name: i.name })))).catch(() => {})
    api.getMentionableUsers().then(setMentionableUsers).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 border-purple-400">
          Waiting to Hear Back From
        </h2>
        <div className="flex items-center gap-3">
          <Link to="/clients?tab=waiting" className="text-xs text-gray-400 hover:text-gray-700 hover:underline">
            Open full list →
          </Link>
          {collapsible && (
            <button onClick={() => setOpen(o => !o)}
              className="text-xs text-gray-400 hover:text-gray-700 font-medium">
              {open ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <WaitingOnSection
            kind="client" title="Clients"
            people={clients} mentionableUsers={mentionableUsers} showLink
          />
          <WaitingOnSection
            kind="instructor" title="Instructors"
            people={instructors} mentionableUsers={mentionableUsers} showLink
          />
        </div>
      )}
    </div>
  )
}
