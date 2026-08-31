import { useEffect, useState } from 'react'
import { api } from '../api/client'
import WaitingOnSection from '../components/WaitingOnSection'
import WaitingOnSuggestions from '../components/WaitingOnSuggestions'

// Waiting to Hear Back From, as its own screen rather than a panel folded into the
// bottom of the Dashboard and My Tasks. Chasing replies is most of the day's work here,
// so it gets a nav slot of its own and opens fully expanded — no click to reveal it.
//
// Same WaitingOnSection component as everywhere else, so adding, starring, resolving
// and note-taking behave identically and there's one implementation to keep correct.
export default function WaitingOnPage() {
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [mentionableUsers, setMentionableUsers] = useState([])
  // Bumped when a suggestion is accepted, to remount both lists so the newly-added
  // item shows straight away.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    // Swallowed on purpose — these only populate the "who are you waiting on?" picker.
    // If one doesn't load the page still works.
    api.getClients().then(cs => setClients(cs.map(c => ({ id: c.id, name: c.name })))).catch(() => {})
    api.getInstructors().then(is => setInstructors(is.map(i => ({ id: i.id, name: i.name })))).catch(() => {})
    api.getMentionableUsers().then(setMentionableUsers).catch(() => {})
  }, [])

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Waiting to Hear Back From</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Everyone who owes us a reply. Star anything urgent and it jumps to the top of its column.
        </p>
      </div>

      <WaitingOnSuggestions onAccepted={() => setRefreshKey(k => k + 1)} />

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <WaitingOnSection
          key={`instructor-${refreshKey}`}
          kind="instructor" title="Instructors"
          people={instructors} mentionableUsers={mentionableUsers} showLink
        />
        <WaitingOnSection
          key={`client-${refreshKey}`}
          kind="client" title="Clients"
          people={clients} mentionableUsers={mentionableUsers} showLink
        />
      </div>
    </div>
  )
}
