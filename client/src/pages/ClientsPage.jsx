import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import NewCaseModal from '../components/NewCaseModal'

const CONTACT_ICONS = { text: '💬', email: '✉️', whatsapp: '📱', call: '📞' }

export default function ClientsPage() {
  const [clients, setClients] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newClient, setNewClient] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', preferred_contact: '', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      api.getClients(query).then(setClients).finally(() => setLoading(false))
    }, query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query])

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const c = await api.createClient(form)
      setClients(prev => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      setNewClient(false)
      setForm({ name: '', phone: '', email: '', preferred_contact: '', notes: '' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Clients</h1>
        <button
          onClick={() => setNewClient(v => !v)}
          className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + New Client
        </button>
      </div>

      {newClient && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="font-semibold text-gray-800 text-sm">New Client</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="718-555-0000" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="client@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preferred Contact</label>
              <select value={form.preferred_contact} onChange={e => setForm(f => ({ ...f, preferred_contact: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="">—</option>
                <option value="text">Text</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="call">Call</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Client'}
            </button>
            <button type="button" onClick={() => setNewClient(false)}
              className="px-4 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : clients.length === 0 ? (
        <p className="text-gray-400 text-sm italic text-center py-8">No clients found.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {clients.map((c, i) => (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className={`flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-100' : ''}`}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.phone || c.email || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {c.preferred_contact && (
                  <span className="text-sm" title={c.preferred_contact}>
                    {CONTACT_ICONS[c.preferred_contact]}
                  </span>
                )}
                <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewCaseModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
