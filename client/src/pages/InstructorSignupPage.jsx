import { useState } from 'react'
import { api } from '../api/client'

// Public, no-login page at /join — an instructor who heard about the new system (e.g. a
// site-wide email to everyone in Shiftboard) opts in here. Staff review and approve/reject
// each submission from Instructors → Sign-ups; approving creates the real instructor
// record + login, same as adding one manually. Mirrors SignContractPage's shape/style.

export default function InstructorSignupPage() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', neighborhood: '', styles_taught: '', specialties: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Please enter your name.'); return }
    setSaving(true)
    setError('')
    try {
      await api.submitInstructorSignup(form)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thanks!</h2>
        <p className="text-sm text-gray-500">
          We've got your info and will be in touch soon. Once approved, you'll get an email
          with instructions to log into bgmoffice.com.
        </p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg w-full p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Join Bring the Gym to Me</h1>
        <p className="text-sm text-gray-500 mb-6">
          Interested in staying on with us? Fill this out and we'll be in touch about getting you set up.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
            <input value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Classes you teach</label>
            <input value={form.styles_taught} onChange={e => set('styles_taught', e.target.value)}
              placeholder="e.g. Zumba, Yoga, Gymnastics"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Specialties</label>
            <input value={form.specialties} onChange={e => set('specialties', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anything else we should know?</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  )
}
