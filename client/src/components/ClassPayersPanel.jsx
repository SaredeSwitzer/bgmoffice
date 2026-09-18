import { useEffect, useState } from 'react'
import SearchSelect from './SearchSelect'
import { api } from '../api/client'

// Splitting the cost of a class between the women in it.
//
// Baila Gutman's Tuesday is $105 and three women share it. Until now there was nowhere to
// say that — a class belongs to one person everywhere in this app — so the payment method
// said "CC-divide", which is a note to a human, and the splitting happened in Sarede's
// head with the cards charged by hand.
//
// What this changes is only who the money is collected FROM. The class is still $105 of
// revenue and the instructor is still paid once; at the end of the week the Billing page
// shows three $35 lines instead of one $105 line, each on that woman's own card.
//
// The panel shows the arithmetic as it will actually happen, including the odd penny,
// because "$100 split three ways" is the moment somebody wants to see the numbers rather
// than be told they add up.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

// The share each person will be charged — the same rule the billing run uses: even split,
// with the remainder going to the first person rather than being rounded away.
function sharesFor(total, count) {
  const amount = Number(total || 0)
  if (!count) return []
  const base = Math.round((amount / count) * 100) / 100
  const remainder = Math.round((amount - base * count) * 100) / 100
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base))
}

export default function ClassPayersPanel({ scheduleId, amount, ownerName, clients = [] }) {
  const [people,  setPeople]  = useState(null)   // null = still loading
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState([])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    api.getClassPayers(scheduleId)
      .then(r => { if (!cancelled) setPeople(r.payers || []) })
      .catch(() => { if (!cancelled) setPeople([]) })
    return () => { cancelled = true }
  }, [scheduleId])

  function startEditing() {
    setDraft((people || []).map(p => ({ id: p.client_id, name: p.client_name })))
    setError('')
    setEditing(true)
  }

  async function save(ids) {
    setSaving(true); setError('')
    try {
      const r = await api.setClassPayers(scheduleId, ids)
      setPeople(r.payers || [])
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  if (people === null) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const shares = sharesFor(amount, editing ? draft.length : people.length)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Splitting this class</h3>
        {!editing && people.length > 0 && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
            {people.length} ways
          </span>
        )}
        {!editing && (
          <button type="button" onClick={startEditing}
            className="ml-auto text-xs font-medium text-blue-600 hover:underline">
            {people.length ? 'Change' : 'Split this class'}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <p className="mb-2 text-xs text-gray-500">
            Everyone who chips in for this class. Each one is charged their share on their
            own card. Leave it empty if {ownerName || 'the client'} pays the whole thing.
          </p>

          <SearchSelect
            multi
            options={clients}
            value={draft}
            onChange={setDraft}
            placeholder="Add someone…"
          />

          {draft.length > 1 && (
            <ul className="mt-3 space-y-1">
              {draft.map((p, i) => (
                <li key={p.id} className="flex items-baseline justify-between text-sm">
                  <span className="text-gray-700">{p.name}</span>
                  <span className="font-medium tabular-nums text-gray-900">{money(shares[i])}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between border-t border-gray-200 pt-1 text-sm">
                <span className="text-gray-500">Class</span>
                <span className="font-semibold tabular-nums text-gray-900">{money(amount)}</span>
              </li>
            </ul>
          )}

          {draft.length === 1 && (
            <p className="mt-2 text-xs text-amber-700">
              One person on their own isn't a split — add someone else, or remove them to
              go back to {ownerName || 'the client'} paying for the whole class.
            </p>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={saving || draft.length === 1}
              onClick={() => save(draft.map(p => p.id))}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </>
      ) : people.length === 0 ? (
        <p className="text-sm text-gray-500">
          {ownerName || 'The client'} pays the whole {money(amount)}.
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {people.map((p, i) => (
              <li key={p.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-gray-700">
                  {p.client_name}
                  {/* A missing card is the thing that silently drops someone out of the
                      weekly run, so it is said here rather than discovered on Friday. */}
                  {!p.has_card && (
                    <span className="ml-1.5 text-[11px] font-medium text-amber-700">no card on file</span>
                  )}
                </span>
                <span className="font-medium tabular-nums text-gray-900">{money(shares[i])}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-gray-200 pt-2 text-xs text-gray-500">
            {money(amount)} a class, charged separately to each card at the end of the week.
          </p>
        </>
      )}
    </div>
  )
}
