import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { today } from '../utils/dates'
import DateInput from './DateInput'
import Byline from './Byline'
import { InstructorLink } from './NameLink'

// Zoom meetings with instructors and candidates, in one place: the room to join, who's
// coming and when, and what was said. Invites sent from "Invite to Meeting" land here on
// their own. Notes are kept on the meeting and also show on the instructor's profile.

const STATUS = {
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700' },
  done:      { label: 'Done',      cls: 'bg-emerald-50 text-emerald-700' },
  no_show:   { label: 'No-show',   cls: 'bg-amber-50 text-amber-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
}

function prettyDate(ymd) {
  if (!ymd) return 'No date'
  const d = new Date(`${ymd}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Opens the Zoom room in a new tab. The link is the same one the invites send.
export function JoinZoomButton({ className = '' }) {
  const [link, setLink] = useState(null)
  useEffect(() => { api.getZoomLink().then(r => setLink(r.link)).catch(() => {}) }, [])
  if (!link) return null
  return (
    <a href={link} target="_blank" rel="noreferrer"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors ${className}`}>
      🎥 Join Zoom
    </a>
  )
}

function MeetingRow({ m, onChanged, onRemoved, showPerson = true }) {
  const [notes, setNotes] = useState(m.notes || '')
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [editingWhen, setEditingWhen] = useState(false)
  const [date, setDate] = useState(m.meeting_date || '')
  const [time, setTime] = useState(m.meeting_time || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dirty = (notes || '') !== (m.notes || '')

  async function patch(data) {
    setSaving(true)
    try { onChanged(await api.updateZoomMeeting(m.id, data)) }
    finally { setSaving(false) }
  }
  async function saveNotes() {
    await patch({ notes })
    setSavedNote(true); setTimeout(() => setSavedNote(false), 2000)
  }
  const st = STATUS[m.status] || STATUS.scheduled

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showPerson && (
            <p className="text-sm font-semibold text-gray-900">
              {m.linked_instructor_id
                ? <InstructorLink id={m.linked_instructor_id} name={m.instructor_name || m.name} />
                : (m.name || m.email || 'Someone')}
              {!m.linked_instructor_id && <span className="ml-1.5 text-[11px] font-normal text-gray-400">not in the app yet</span>}
            </p>
          )}
          {editingWhen ? (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <div className="w-44"><DateInput value={date} onChange={setDate} /></div>
              <input value={time} onChange={e => setTime(e.target.value)} placeholder="3:00pm"
                className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              <button type="button" disabled={saving}
                onClick={async () => { await patch({ meeting_date: date, meeting_time: time }); setEditingWhen(false) }}
                className="text-xs font-semibold text-blue-600 hover:underline">Save</button>
              <button type="button" onClick={() => setEditingWhen(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
            </div>
          ) : (
            <p className="text-xs text-gray-600 mt-0.5">
              {prettyDate(m.meeting_date)}{m.meeting_time ? ` · ${m.meeting_time}` : ''}
              <button type="button" onClick={() => setEditingWhen(true)} className="ml-2 text-blue-600 hover:underline">change</button>
            </p>
          )}
          {showPerson && (m.email || m.phone) && (
            <p className="text-[11px] text-gray-400 mt-0.5">{[m.email, m.phone].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          {m.status !== 'done' && (
            <button type="button" disabled={saving} onClick={() => patch({ status: 'done' })}
              className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 text-emerald-700 hover:bg-emerald-50">Mark done</button>
          )}
          {m.status === 'scheduled' && (<>
            <button type="button" disabled={saving} onClick={() => patch({ status: 'no_show' })}
              className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">No-show</button>
            <button type="button" disabled={saving} onClick={() => patch({ status: 'cancelled' })}
              className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">Cancelled</button>
          </>)}
          {m.status !== 'scheduled' && (
            <button type="button" disabled={saving} onClick={() => patch({ status: 'scheduled' })}
              className="text-[11px] text-gray-400 hover:underline">undo</button>
          )}
        </div>
      </div>

      <div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Notes from the call — how it went, what they teach, availability, next step…"
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <div className="flex items-center gap-3">
          {dirty && (
            <button type="button" onClick={saveNotes} disabled={saving}
              className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          )}
          {savedNote && <span className="text-xs text-emerald-700">✓ Saved</span>}
          {m.notes && !dirty && <Byline author={m.notes_by} at={m.notes_at} prefix="Notes by" />}
          <span className="flex-1" />
          <Byline author={m.created_by} at={m.created_at} prefix={m.invite_sent_at ? 'Invite sent by' : 'Added by'} />
          {confirmDelete ? (
            <span className="text-[11px] text-gray-600">
              Remove this meeting?{' '}
              <button type="button" className="text-red-600 font-semibold hover:underline"
                onClick={async () => { await api.deleteZoomMeeting(m.id); onRemoved(m.id) }}>Remove</button>{' '}
              <button type="button" className="hover:underline" onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-[11px] text-gray-400 hover:text-red-500">Remove</button>
          )}
        </div>
      </div>
    </li>
  )
}

function AddMeetingForm({ instructors, onAdded, onCancel }) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [error, setError] = useState('')
  const q = name.trim().toLowerCase()
  const matches = !picked && q.length >= 2
    ? instructors.filter(i => (i.name || '').toLowerCase().includes(q)).slice(0, 6) : []

  async function submit(e) {
    e.preventDefault()
    if (!name.trim() && !email.trim()) { setError('Who is the meeting with?'); return }
    try {
      onAdded(await api.addZoomMeeting({
        name, email, phone, meeting_date: date, meeting_time: time, instructor_id: picked?.id || null,
      }))
    } catch (err) { setError(err.message || 'Could not add it.') }
  }

  return (
    <form onSubmit={submit} className="px-4 py-3 bg-gray-50 border-b border-gray-200 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="relative">
          <input value={name} onChange={e => { setName(e.target.value); setPicked(null) }} autoComplete="off"
            placeholder="Name — instructors on file pop up"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          {matches.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
              {matches.map(i => (
                <li key={i.id}>
                  <button type="button" onMouseDown={e => {
                    e.preventDefault(); setPicked(i); setName(i.name)
                    if (i.email) setEmail(i.email); if (i.phone) setPhone(i.phone)
                  }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">{i.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <div className="flex gap-2">
          <div className="flex-1"><DateInput value={date} onChange={setDate} /></div>
          <input value={time} onChange={e => setTime(e.target.value)} placeholder="3:00pm"
            className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700">Add meeting</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 hover:underline">Cancel</button>
      </div>
      <p className="text-[11px] text-gray-400">This only adds it to the schedule — to email them the link, use Invite to Meeting.</p>
    </form>
  )
}

// The Zoom Meetings tab on the Instructors page.
export default function ZoomMeetingsTab({ instructors = [] }) {
  const [meetings, setMeetings] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const load = useCallback(() => { api.getZoomMeetings().then(setMeetings).catch(() => setMeetings([])) }, [])
  useEffect(() => { load() }, [load])

  const replace = m => setMeetings(list => list.map(x => (x.id === m.id ? m : x)))
  const remove = id => setMeetings(list => list.filter(x => x.id !== id))

  const t = today()
  const all = meetings || []
  // Coming up: scheduled for today or later (or with no date yet), soonest first.
  const upcoming = all.filter(m => m.status === 'scheduled' && (!m.meeting_date || m.meeting_date >= t))
    .sort((a, b) => (a.meeting_date || '9999').localeCompare(b.meeting_date || '9999'))
  // Anything scheduled for a day that's passed still needs saying how it went.
  const needsUpdate = all.filter(m => m.status === 'scheduled' && m.meeting_date && m.meeting_date < t)
  const past = all.filter(m => m.status !== 'scheduled')

  const section = (title, list, empty) => (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">{title} ({list.length})</p>
      {list.length === 0
        ? <p className="px-4 py-3 text-sm text-gray-400">{empty}</p>
        : <ul className="divide-y divide-gray-100">{list.map(m => <MeetingRow key={m.id} m={m} onChanged={replace} onRemoved={remove} />)}</ul>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <JoinZoomButton />
        <button type="button" onClick={() => setAdding(v => !v)}
          className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
          + Add meeting
        </button>
        <p className="text-xs text-gray-400">Invites sent from “Invite to Meeting” show up here on their own.</p>
      </div>
      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <AddMeetingForm instructors={instructors}
            onAdded={m => { setMeetings(list => [m, ...(list || [])]); setAdding(false) }}
            onCancel={() => setAdding(false)} />
        </div>
      )}
      {meetings === null ? <p className="text-sm text-gray-400">Loading…</p> : (<>
        {needsUpdate.length > 0 && section('How did it go?', needsUpdate, '')}
        {section('Coming up', upcoming, 'Nothing scheduled. Send an invite or add a meeting.')}
        <button type="button" onClick={() => setShowPast(v => !v)} className="text-xs text-blue-600 hover:underline">
          {showPast ? 'Hide past meetings' : `Show past meetings (${past.length})`}
        </button>
        {showPast && section('Past', past, 'None yet.')}
      </>)}
    </div>
  )
}

// On an instructor's profile: their meetings and the notes from each.
export function ZoomMeetingsForInstructor({ instructorId }) {
  const [meetings, setMeetings] = useState([])
  useEffect(() => {
    if (instructorId) api.getZoomMeetings(instructorId).then(setMeetings).catch(() => {})
  }, [instructorId])
  if (!meetings.length) return null
  const replace = m => setMeetings(list => list.map(x => (x.id === m.id ? m : x)))
  const remove = id => setMeetings(list => list.filter(x => x.id !== id))
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">Zoom meetings</p>
      <ul className="divide-y divide-gray-100">
        {meetings.map(m => <MeetingRow key={m.id} m={m} onChanged={replace} onRemoved={remove} showPerson={false} />)}
      </ul>
    </div>
  )
}
