import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import SearchSelect from './SearchSelect'

// Shows who's been sent an org contract and who's signed/paid. Signing never creates a
// client record on its own — new clients created with a matching email link up
// automatically, but this lets staff link a signature manually for any other case.
export default function ClientContractSignaturesPanel({ clients, refreshKey }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState({})

  function load() {
    setLoading(true)
    api.getClientContractSignatures().then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }

  useEffect(load, [refreshKey])

  async function handleLink(sig, client) {
    if (!client) return
    setLinking(l => ({ ...l, [sig.id]: true }))
    try {
      await api.linkClientContractSignature(sig.id, client.id)
      load()
    } finally {
      setLinking(l => ({ ...l, [sig.id]: false }))
    }
  }

  async function handleDismiss(sig) {
    setRows(prev => prev.filter(r => r.id !== sig.id))
    try {
      await api.dismissClientContractSignature(sig.id)
    } catch {
      load() // put it back if the dismiss didn't actually save
    }
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const fmtMoney = (n) => n == null ? '' : `$${Number(n).toFixed(0)}`

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
            {sig.client_id ? (
              <Link to={`/clients/${sig.client_id}`} className="font-medium text-gray-900 hover:text-blue-600 hover:underline truncate block">
                {sig.org_name || sig.contact_name || sig.email}
              </Link>
            ) : (
              <p className="font-medium text-gray-900 truncate">{sig.org_name || sig.contact_name || sig.email}</p>
            )}
            <p className="text-xs text-gray-400 truncate">
              {sig.email}{sig.deposit_amount ? ` · Deposit ${fmtMoney(sig.deposit_amount)}${sig.deposit_paid_at ? ' (paid)' : ' (unpaid)'}` : ''}
            </p>
          </div>
          <div className="text-xs text-right shrink-0">
            {sig.signed_at && sig.client_id ? (
              <Link to={`/clients/${sig.client_id}`} className="text-emerald-700 hover:text-emerald-900 hover:underline">
                ✓ Signed &amp; linked to {sig.client_name}
              </Link>
            ) : sig.signed_at ? (
              <span className="text-amber-600">Signed {fmt(sig.signed_at)} — not linked</span>
            ) : sig.client_id ? (
              <Link to={`/clients/${sig.client_id}`} className="text-orange-600 hover:text-orange-800 hover:underline">
                Sent to {sig.client_name} — waiting for them to sign
              </Link>
            ) : (
              <span className="text-orange-600">Sent {fmt(sig.sent_at)} — awaiting signature</span>
            )}
          </div>
          {sig.signed_at && !sig.client_id && (
            <div className="w-48 shrink-0">
              <SearchSelect
                options={clients}
                value={null}
                onChange={client => handleLink(sig, client)}
                placeholder={linking[sig.id] ? 'Linking…' : 'Link to client…'}
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
