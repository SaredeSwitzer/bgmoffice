import { useEffect, useState } from 'react'
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
            <p className="font-medium text-gray-900 truncate">{sig.org_name || sig.contact_name || sig.email}</p>
            <p className="text-xs text-gray-400 truncate">
              {sig.email}{sig.deposit_amount ? ` · Deposit ${fmtMoney(sig.deposit_amount)}${sig.deposit_paid_at ? ' (paid)' : ' (unpaid)'}` : ''}
            </p>
          </div>
          <div className="text-xs text-right shrink-0">
            {sig.client_id ? (
              <span className="text-emerald-700">✓ Signed &amp; linked to {sig.client_name}</span>
            ) : sig.signed_at ? (
              <span className="text-amber-600">Signed {fmt(sig.signed_at)} — not linked</span>
            ) : (
              <span className="text-gray-400">Sent {fmt(sig.sent_at)} — awaiting signature</span>
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
        </div>
      ))}
    </div>
  )
}
