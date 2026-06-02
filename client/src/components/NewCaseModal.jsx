import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

export default function NewCaseModal({ clientId, instructorId, onClose }) {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [instructors, setInstructors] = useState([])
  const [form, setForm] = useState({
    client_id: clientId || '',
    instructor_id: instructorId || '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([api.getClients(), api.getInstructors()])
      .then(([c, i]) => { setClients(c); setInstructors(i) })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const c = await api.createCase({
        client_id: form.client_id ? Number(form.client_id) : null,
        instructor_id: form.instructor_id ? Number(form.instructor_id) : null,
      })
      onClose()
      navigate(`/cases/${c.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-gray-900 mb-4">Open New Case</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <select
              value={form.client_id}
              onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instructor</label>
            <select
              value={form.instructor_id}
              onChange={e => setForm(f => ({ ...f, instructor_id: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
              {saving ? 'Opening…' : 'Open Case'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
