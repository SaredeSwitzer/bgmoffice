import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { isSaredeUser } from '../utils/saredeAccess'
import SearchSelect from '../components/SearchSelect'
import MentionTextarea from '../components/MentionTextarea'
import { renderWithMentions } from '../utils/mentions'

function fmt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Note thread — same lazy-load-on-expand pattern as ReminderNoteThread
// (client/src/pages/RemindersPage.jsx), just pointed at sales leads instead. ──────────

function LeadNoteThread({ leadId, initialCount, mentionableUsers }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState(null)
  const [count, setCount] = useState(initialCount || 0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (notes === null) {
      setLoading(true)
      api.getSalesLeadNotes(leadId).then(setNotes).finally(() => setLoading(false))
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      const note = await api.addSalesLeadNote(leadId, text.trim())
      setNotes(prev => [...(prev || []), note])
      setCount(c => c + 1)
      setText('')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(noteId) {
    await api.deleteSalesLeadNote(leadId, noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
    setCount(c => Math.max(0, c - 1))
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-xs text-gray-400 hover:text-gray-700 font-medium">
        💬 {count > 0 ? `${count} note${count === 1 ? '' : 's'}` : 'Add a note'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 bg-gray-50 border border-gray-100 rounded-xl p-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : notes?.length > 0 ? (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className="flex gap-2 items-start group">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
                    {n.author_initials}
                  </div>
                  <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl rounded-tl-sm px-2.5 py-1.5">
                    <p className="text-xs text-gray-800 whitespace-pre-wrap">{renderWithMentions(n.text, mentionableUsers)}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{fmt(n.created_at)}</p>
                  </div>
                  <button onClick={() => handleDelete(n.id)}
                    className="text-gray-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No notes yet.</p>
          )}
          <form onSubmit={handleSend} className="flex gap-2 items-start">
            <MentionTextarea value={text} onChange={setText} users={mentionableUsers}
              placeholder={`Note as ${user?.initials}… (type @ to tag someone)`} rows={1}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
            <button type="submit" disabled={sending || !text.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-40 flex-shrink-0">
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Add-lead form ────────────────────────────────────────────────────────────────────

function AddLeadForm({ clients, onAdded }) {
  const [selectedClient, setSelectedClient] = useState(null)
  const [manualName, setManualName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const name = selectedClient ? selectedClient.name : manualName.trim()
    if (!name) return
    setSaving(true)
    try {
      const lead = await api.createSalesLead({ name, client_id: selectedClient?.id || null })
      onAdded(lead)
      setSelectedClient(null)
      setManualName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SearchSelect
          label="Tag an existing client (optional)"
          options={clients}
          value={selectedClient}
          onChange={v => { setSelectedClient(v); if (v) setManualName('') }}
          placeholder="Search clients…"
        />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Or just type a name (not a client yet)
          </label>
          <input
            value={manualName}
            onChange={e => { setManualName(e.target.value); if (e.target.value) setSelectedClient(null) }}
            disabled={!!selectedClient}
            placeholder="e.g. a lead you haven't added to the app"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
      </div>
      <button type="submit" disabled={saving || !(selectedClient || manualName.trim())}
        className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700">
        {saving ? 'Adding…' : '+ Add to list'}
      </button>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const { user } = useAuth()
  const [leads, setLeads] = useState([])
  const [clients, setClients] = useState([])
  const [mentionableUsers, setMentionableUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getSalesLeads(),
      api.getClients(),
      api.getMentionableUsers(),
    ])
      .then(([l, c, mu]) => { setLeads(l); setClients(c); setMentionableUsers(mu) })
      .finally(() => setLoading(false))
  }, [])

  function handleAdded(lead) {
    setLeads(prev => [lead, ...prev])
  }

  async function handleDelete(id) {
    if (!confirm('Remove this lead from your list?')) return
    await api.deleteSalesLead(id)
    setLeads(prev => prev.filter(l => l.id !== id))
  }

  if (!isSaredeUser(user)) {
    return <p className="text-sm text-gray-400 italic">Not available on this account.</p>
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Sales</h1>
        <p className="text-sm text-gray-500 mt-0.5">Clients and leads you're planning to reach out to about buying more/new classes.</p>
      </div>

      <AddLeadForm clients={clients} onAdded={handleAdded} />

      {leads.length === 0 ? (
        <p className="text-sm text-gray-400 italic px-2">Nothing on your list yet.</p>
      ) : (
        <div className="space-y-2">
          {leads.map(lead => (
            <div key={lead.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {lead.client_id ? (
                    <Link to={`/clients/${lead.client_id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                      {lead.linked_client_name || lead.name} →
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-gray-900">{lead.name}</span>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Added {fmt(lead.created_at)}{lead.created_by ? ` — ${lead.created_by}` : ''}
                    {!lead.client_id && <span className="italic"> · not yet a client</span>}
                  </p>
                </div>
                <button onClick={() => handleDelete(lead.id)}
                  className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">Remove</button>
              </div>
              <LeadNoteThread leadId={lead.id} initialCount={lead.note_count} mentionableUsers={mentionableUsers} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
