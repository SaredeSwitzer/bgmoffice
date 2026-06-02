import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function InstructorsPage() {
  const [instructors, setInstructors] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [newInstructor, setNewInstructor] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', specialties: '', style: '', notes: '', pay_rate: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      api.getInstructors(query).then(setInstructors).finally(() => setLoading(false))
    }, query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query])

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const i = await api.createInstructor(form)
      setInstructors(prev => [...prev, i].sort((a, b) => a.name.localeCompare(b.name)))
      setNewInstructor(false)
      setForm({ name: '', phone: '', email: '', specialties: '', style: '', notes: '', pay_rate: '' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Instructors</h1>
        <button
          onClick={() => setNewInstructor(v => !v)}
          className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          + New Instructor
        </button>
      </div>

      {newInstructor && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
          <h3 className="font-semibold text-gray-800 text-sm">New Instructor</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Specialties</label>
              <input value={form.specialties} onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="Yoga, Pilates…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Pay Rate</label>
              <input value={form.pay_rate} onChange={e => setForm(f => ({ ...f, pay_rate: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" placeholder="$85/hr" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
              <input value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
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
              {saving ? 'Saving…' : 'Save Instructor'}
            </button>
            <button type="button" onClick={() => setNewInstructor(false)}
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
          placeholder="Search instructors…"
          className="w-full border border-gray-300 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm text-center py-8">Loading…</p>
      ) : instructors.length === 0 ? (
        <p className="text-gray-400 text-sm italic text-center py-8">No instructors found.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {instructors.map((inst, i) => (
            <Link
              key={inst.id}
              to={`/instructors/${inst.id}`}
              className={`flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors ${i > 0 ? 'border-t border-gray-100' : ''}`}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{inst.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{inst.specialties || inst.phone || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {inst.pay_rate && (
                  <span className="text-xs text-gray-400 font-medium">{inst.pay_rate}</span>
                )}
                <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
