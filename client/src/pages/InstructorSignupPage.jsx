import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import SignupOptionPicker from '../components/SignupOptionPicker'

// Public, no-login page at /join — an instructor who heard about the new system (e.g. a
// site-wide email to everyone in Shiftboard) opts in here. Staff review and approve/reject
// each submission from Instructors → Sign-ups; approving creates the real instructor
// record + login, same as adding one manually. Mirrors SignContractPage's shape/style.

// Common answers, offered as one-tap buttons. Kept short on purpose — a long list is
// slower to read than typing, and "Other" is already covered by the free-text field.
const HEARD_ABOUT_OPTIONS = [
  'Another instructor',
  'A friend',
  'Google',
  'Facebook',
  'Instagram',
  'WhatsApp group',
  'Shiftboard',
]

export default function InstructorSignupPage() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', neighborhood: '', city: '', state: '', styles_taught: '', specialties: '', notes: '',
    heard_about_us: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)
  const [neighborhoods, setNeighborhoods] = useState([])
  const [regions, setRegions] = useState([])
  const [classStyles, setClassStyles] = useState([])

  useEffect(() => {
    api.getSignupNeighborhoods()
      .then(d => { setNeighborhoods(d.neighborhoods || []); setRegions(d.regions || []) })
      .catch(() => {})
    api.getSignupClassStyles().then(setClassStyles).catch(() => {})
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // The neighborhood multi-picker is for NY instructors only — everyone else keeps the
  // plain free-text field, since the canonical list is NY-area and asking someone in
  // New Jersey to pick from it (or worse, add their town to it) isn't useful.
  const isNY = ['ny', 'new york'].includes(form.state.trim().toLowerCase())

  async function handleAddNeighborhood(name, region) {
    const row = await api.addSignupNeighborhood(name, region)
    setNeighborhoods(prev => prev.some(n => n.id === row.id) ? prev : [...prev, row])
    return row
  }

  async function handleAddClassStyle(name) {
    const row = await api.addSignupClassStyle(name)
    setClassStyles(prev => prev.some(s => s.id === row.id) ? prev : [...prev, row])
    return row
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Please enter your name.'); return }
    setSaving(true)
    setError('')
    try {
      const result = await api.submitInstructorSignup(form)
      if (result.already_registered) setAlreadyRegistered(true)
      else setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (alreadyRegistered) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">👋</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Looks like you're already set up!</h2>
        <p className="text-sm text-gray-500 mb-5">
          That email already has an account with us — no need to sign up again. Just log in instead.
        </p>
        <Link to="/login" className="inline-block px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 transition-colors">
          Go to Login
        </Link>
      </div>
    </div>
  )

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
        <p className="text-sm text-gray-500 mb-1">
          Interested in staying on with us? Fill this out and we'll be in touch about getting you set up.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Log in instead</Link>.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
              <input value={form.city} onChange={e => set('city', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
              <input value={form.state} onChange={e => set('state', e.target.value)}
                placeholder="NY" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {isNY ? 'Neighborhoods you can teach in' : 'Neighborhood'}
            </label>
            {isNY ? (
              <>
                <p className="text-[11px] text-gray-400 mb-1.5">
                  Tap all the ones you'd travel to. Not listed? Use “+ Other”.
                </p>
                <SignupOptionPicker
                  options={neighborhoods}
                  regions={regions}
                  value={form.neighborhood}
                  onChange={v => set('neighborhood', v)}
                  onAdd={handleAddNeighborhood}
                  addLabel="neighborhood"
                />
              </>
            ) : (
              <input value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Classes you teach</label>
            <p className="text-[11px] text-gray-400 mb-1.5">
              Tap everything you teach. Teach something we don’t list? Use “+ Other”.
            </p>
            <SignupOptionPicker
              options={classStyles}
              value={form.styles_taught}
              onChange={v => set('styles_taught', v)}
              onAdd={handleAddClassStyle}
              addLabel="class style"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Specialties</label>
            <input value={form.specialties} onChange={e => set('specialties', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              How did you find out about Bring the Gym to Me?
            </label>
            {/* Buttons for the common answers so it's one tap on a phone, but the field
                stays free text underneath — the genuinely useful answers here tend to be
                the ones nobody thought to list. */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {HEARD_ABOUT_OPTIONS.map(opt => (
                <button
                  key={opt} type="button"
                  onClick={() => set('heard_about_us', form.heard_about_us === opt ? '' : opt)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    form.heard_about_us === opt
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <input
              value={form.heard_about_us}
              onChange={e => set('heard_about_us', e.target.value)}
              placeholder="Or tell us in your own words — who referred you?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Anything else we should know?</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300" />
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
