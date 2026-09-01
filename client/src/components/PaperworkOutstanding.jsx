import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ContractSignaturesPanel from './ContractSignaturesPanel'
import ClientContractSignaturesPanel from './ClientContractSignaturesPanel'

// Contracts and waivers we're still waiting on signatures for.
//
// This used to be entries on the general waiting-on list, which meant somebody had to
// remember to add a row and later remember to clear it — 42 stale "waiver missing" rows
// had built up by the time it moved. Missing paperwork is something the app already
// knows, so it's worked out live from the records themselves and can't drift.

function MissingWaivers({ clients }) {
  const missing = clients.filter(c => !c.waiver_signed)
  if (!missing.length) {
    return <p className="text-sm text-green-700">Every client has a signed waiver on file.</p>
  }
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        {missing.length} client{missing.length === 1 ? '' : 's'} with no signed waiver on file.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {missing.map(c => (
          <Link key={c.id} to={`/clients/${c.id}`}
            className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2.5 py-1 hover:bg-amber-100">
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  )
}

function MissingContracts({ instructors }) {
  const missing = instructors.filter(i => !i.contract_signed)
  if (!missing.length) {
    return <p className="text-sm text-green-700">Every instructor has a signed contract on file.</p>
  }
  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        {missing.length} instructor{missing.length === 1 ? '' : 's'} with no signed contract on file.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {missing.map(i => (
          <Link key={i.id} to={`/instructors/${i.id}`}
            className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2.5 py-1 hover:bg-amber-100">
            {i.name}
          </Link>
        ))}
      </div>
    </div>
  )
}

export default function PaperworkOutstanding({ kind, clients = [], instructors = [] }) {
  const [refreshKey] = useState(0)
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    const load = kind === 'client' ? api.getClientContractSignatures : api.getContractSignatures
    load().then(rows => setCounts(rows.filter(r => !r.signed_at && !r.dismissed_at).length)).catch(() => setCounts(null))
  }, [kind])

  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-2 pl-1 border-l-4 border-amber-400">
          {kind === 'client' ? 'Waivers not on file' : 'Contracts not on file'}
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {kind === 'client'
            ? <MissingWaivers clients={clients} />
            : <MissingContracts instructors={instructors} />}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-2 pl-1 border-l-4 border-blue-400">
          Contracts sent, awaiting signature
          {counts > 0 && (
            <span className="ml-2 text-xs font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">{counts}</span>
          )}
        </h2>
        {kind === 'client'
          ? <ClientContractSignaturesPanel clients={clients} refreshKey={refreshKey} />
          : <ContractSignaturesPanel instructors={instructors} refreshKey={refreshKey} />}
      </section>
    </div>
  )
}
