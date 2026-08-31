import { useEffect, useState } from 'react'
import { api } from '../api/client'
import CollapsibleSection from './CollapsibleSection'

// Options an instructor typed in themselves — a class style on the sign-up form, a
// neighbourhood on their profile. They're live in the pickers the moment they're typed
// (they have to be), so this isn't a gate. It's the tidy-up pass: the common case is
// approving "prospect heights" as "Prospect Heights", which fixes the spelling on the
// master list and on everyone who already picked it.

const KIND_LABEL = {
  class_style:  'Class style',
  neighborhood: 'Neighborhood',
}

const REGIONS = [
  'Brooklyn', 'Manhattan', 'Queens', 'Bronx', 'Staten Island',
  'Westchester & Upstate', 'Long Island', 'New Jersey', 'Other',
]

// A name is worth a second look when it's all-lowercase, SHOUTING, or has stray
// double spaces — exactly the cases where you'd want to fix the spelling before it
// spreads. Flagging them saves reading every row carefully.
function looksUntidy(name) {
  const n = String(name || '')
  if (!n.trim()) return false
  if (n !== n.trim() || /\s{2,}/.test(n)) return true
  const letters = n.replace(/[^A-Za-z]/g, '')
  if (!letters) return false
  return letters === letters.toLowerCase() || letters === letters.toUpperCase()
}

// "prospect heights" -> "Prospect Heights". Leaves anything already capitalised alone,
// so a deliberate lowercase-y name only changes if you say so.
function titleCase(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function ApprovalRow({ item, onDecided }) {
  const [name, setName]     = useState(item.submitted_name)
  const [region, setRegion] = useState(item.region || 'Other')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const changed  = name.trim() !== item.submitted_name
  const suggest  = titleCase(item.submitted_name)
  const canTidy  = suggest !== item.submitted_name && name.trim() !== suggest

  async function approve() {
    if (!name.trim()) { setError('Give it a name first.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await api.approveOption(item.id, {
        name: name.trim(),
        ...(item.kind === 'neighborhood' ? { region } : {}),
      })
      onDecided(item.id, res.merged_into
        ? `Merged into "${res.merged_into}"`
        : changed ? `Approved as "${name.trim()}"` : 'Approved')
    } catch (e) {
      setError(e.message || 'Could not save that.')
      setSaving(false)
    }
  }

  async function reject() {
    setSaving(true)
    setError('')
    try {
      await api.rejectOption(item.id)
      onDecided(item.id, 'Removed')
    } catch (e) {
      setError(e.message || 'Could not remove that.')
      setSaving(false)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
          {KIND_LABEL[item.kind] || item.kind}
        </span>
        <span className="text-xs text-gray-400">
          added {item.instructor_name ? `by ${item.instructor_name} ` : ''}
          {item.source === 'profile' ? 'on their profile' : 'on the sign-up form'}
        </span>
        {looksUntidy(item.submitted_name) && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
            check spelling
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') approve() }}
          disabled={saving}
          className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        {item.kind === 'neighborhood' && (
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            disabled={saving}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-600 bg-white disabled:opacity-50"
          >
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <button
          onClick={approve} disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '…' : changed ? 'Approve with this name' : 'Approve'}
        </button>
        <button
          onClick={reject} disabled={saving}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50"
        >
          Remove
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        {canTidy && (
          <button
            onClick={() => setName(suggest)}
            className="text-[11px] text-blue-600 hover:underline"
          >
            Fix to &ldquo;{suggest}&rdquo;
          </button>
        )}
        {changed && (
          <span className="text-[11px] text-gray-400">
            Renaming updates it everywhere it&rsquo;s already been used.
          </span>
        )}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  )
}

export default function NeedsApproval({ id = 'mytasks_approvals', defaultOpen = true }) {
  const [items, setItems]   = useState([])
  const [done, setDone]     = useState([])   // decided in this sitting, kept visible
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getPendingApprovals()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // Decided rows stay on screen with a green outcome rather than vanishing — the same
  // rule the contract/waiver lists follow, so you can see what you just did.
  function handleDecided(itemId, outcome) {
    setItems(prev => {
      const row = prev.find(i => i.id === itemId)
      if (row) setDone(d => [...d, { ...row, outcome }])
      return prev.filter(i => i.id !== itemId)
    })
  }

  if (loading) return null
  if (!items.length && !done.length) return null

  return (
    <CollapsibleSection
      id={id} accent="amber" title="✋ Needs Approval"
      count={items.length} defaultOpen={defaultOpen}
    >
      <p className="text-xs text-gray-400 mb-2 px-1">
        New options instructors typed in themselves. They&rsquo;re already live — approving
        just confirms the spelling, and you can fix it here before it spreads.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {items.map(item => (
          <ApprovalRow key={item.id} item={item} onDecided={handleDecided} />
        ))}
        {done.map(item => (
          <div key={`done-${item.id}`} className="flex items-center gap-2 px-4 py-2.5 bg-green-50/50">
            <span className="text-green-600 text-sm">✓</span>
            <span className="text-sm text-gray-500 line-through">{item.submitted_name}</span>
            <span className="text-xs font-medium text-green-700">{item.outcome}</span>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  )
}
