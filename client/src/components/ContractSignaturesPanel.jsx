import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'

// Shows who's been sent the contract and who's signed it. Signing never creates an
// instructor record on its own — new instructors created with a matching email link up
// automatically, but this lets staff link a signature manually for any other case.
export default function ContractSignaturesPanel({ instructors, refreshKey }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState({})

  function load() {
    setLoading(true)
    api.getContractSignatures().then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }

  useEffect(load, [refreshKey])

  async function handleLink(sig, instructor) {
    if (!instructor) return
    setLinking(l => ({ ...l, [sig.id]: true }))
    try {
      await api.linkContractSignature(sig.id, instructor.id)
      load()
    } finally {
      setLinking(l => ({ ...l, [sig.id]: false }))
    }
  }

  async function handleDismiss(sig) {
    setRows(prev => prev.filter(r => r.id !== sig.id))
    try {
      await api.dismissContractSignature(sig.id)
    } catch {
      load() // put it back if the dismiss didn't actually save
    }
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

  if (loading) return null
  if (rows.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
      <div className="px-4 py-2.5">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contract Signatures</h3>
      </div>
      {rows.map(sig => (
        <div key={sig.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 truncate">{sig.name || sig.email}</p>
            <p className="text-xs text-gray-400 truncate">
              {sig.email}{sig.ssn_last4 ? ` · SSN •••-••-${sig.ssn_last4}` : ''}
            </p>
          </div>
          <div className="text-xs text-right shrink-0">
            {sig.instructor_id ? (
              <span className="text-emerald-700">✓ Signed &amp; linked to {sig.instructor_name}</span>
            ) : sig.signed_at ? (
              <span className="text-amber-600">Signed {fmt(sig.signed_at)} — not linked</span>
            ) : (
              <span className="text-gray-400">Sent {fmt(sig.sent_at)} — awaiting signature</span>
            )}
          </div>
          {sig.signed_at && !sig.instructor_id && (
            <div className="w-48 shrink-0">
              <SearchSelect
                options={instructors}
                value={null}
                onChange={inst => handleLink(sig, inst)}
                placeholder={linking[sig.id] ? 'Linking…' : 'Link to instructor…'}
              />
            </div>
          )}
          <button onClick={() => handleDismiss(sig)} title="Dismiss — hide this from the list"
            className="text-gray-300 hover:text-red-500 text-lg leading-none shrink-0">×</button>
        </div>
      ))}
    </div>
  )
}
