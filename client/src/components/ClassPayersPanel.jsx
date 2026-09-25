import { useEffect, useState } from 'react'
import SearchSelect from './SearchSelect'
import { api } from '../api/client'

// Splitting the cost of a class between cards.
//
// Baila Gutman's Tuesday is $105 and three women share it. Until 18 Sep there was nowhere
// to say that — a class belongs to one person everywhere in this app — so the payment
// method said "CC-divide", which is a note to a human, and the splitting happened in
// Sarede's head with the cards charged by hand.
//
// A share is a person *and a card*, because the third woman's card was saved onto Baila's
// own file: the same person can be on the list twice, once per card, and each line is
// charged separately at the end of the week. The card picker lists every card on that
// person's file.
//
// What this changes is only who the money is collected FROM. The class is still $105 of
// revenue and the instructor is still paid once.
//
// Works on a recurring class (scheduleId — every week) or on a one-off class (sessionId).

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

// The share each line will be charged — the same rule the billing run uses: even split,
// with the remainder going to the first line rather than being rounded away.
function sharesFor(total, count) {
  const amount = Number(total || 0)
  if (!count) return []
  const base = Math.round((amount / count) * 100) / 100
  const remainder = Math.round((amount - base * count) * 100) / 100
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base))
}

function cardName(c) {
  const digits = `${c.brand ? `${c.brand[0].toUpperCase()}${c.brand.slice(1)} ` : ''}•••• ${c.last4}`
  return c.label ? `${c.label} (${digits})` : digits
}

function shownCard(p) {
  if (!p.has_card) return null
  const digits = `•••• ${p.card_last4}`
  return p.card_label ? `${p.card_label} ${digits}` : digits
}

export default function ClassPayersPanel({ scheduleId, sessionId, amount, ownerName, clients = [] }) {
  const [people,  setPeople]  = useState(null)   // null = still loading
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState([])     // [{ client_id, name, card_id }]
  const [cards,   setCards]   = useState({})     // client_id → cards on their file
  const [adderKey, setAdderKey] = useState(0)    // remounts the picker so it clears after each add
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    const load = scheduleId
      ? api.getClassPayers(scheduleId).then(r => r.payers || [])
      : api.getSessionPayers(sessionId).then(r => r.override || [])
    load
      .then(list => { if (!cancelled) setPeople(list) })
      .catch(() => { if (!cancelled) setPeople([]) })
    return () => { cancelled = true }
  }, [scheduleId, sessionId])

  function loadCards(clientId) {
    if (cards[clientId]) return Promise.resolve(cards[clientId])
    return api.getClientCards(clientId)
      .then(list => { setCards(prev => ({ ...prev, [clientId]: list || [] })); return list || [] })
      .catch(() => [])
  }

  function startEditing() {
    const list = (people || []).map(p => ({ client_id: p.client_id, name: p.client_name, card_id: p.card_id || null }))
    list.forEach(p => loadCards(p.client_id))
    setDraft(list)
    setError('')
    setEditing(true)
  }

  // Adding someone already on the list is how a second card on their file gets its own
  // share, so it picks the next card of theirs that isn't on the list yet.
  async function addPerson(c) {
    if (!c) return
    setAdderKey(k => k + 1)
    const list = await loadCards(c.id)
    setDraft(prev => {
      const used = new Set(prev.filter(p => p.client_id === c.id).map(p => p.card_id || defaultCardId(list)))
      const next = list.find(k => !used.has(k.id))
      const card_id = next && !next.is_default ? next.id : null
      return [...prev, { client_id: c.id, name: c.name, card_id }]
    })
  }

  function defaultCardId(list) {
    return (list || []).find(k => k.is_default)?.id ?? null
  }

  function setCard(i, value) {
    const list = cards[draft[i].client_id] || []
    const card = list.find(k => String(k.id) === value)
    setDraft(prev => prev.map((p, j) => j === i ? { ...p, card_id: card && !card.is_default ? card.id : null } : p))
  }

  function remove(i) {
    setDraft(prev => prev.filter((_, j) => j !== i))
  }

  async function save(list) {
    setSaving(true); setError('')
    try {
      const payers = list.map(p => ({ client_id: p.client_id, card_id: p.card_id }))
      const r = scheduleId
        ? await api.setClassPayers(scheduleId, payers)
        : await api.setSessionPayers(sessionId, payers)
      setPeople((scheduleId ? r.payers : r.override) || [])
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
  // The same card twice would be two charges on one card for no reason.
  const dupCard = editing && new Set(draft.map(p => `${p.client_id}:${p.card_id || 0}`)).size !== draft.length

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Splitting between cards</h3>
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
            Each line is charged its share on the card you pick. If a second person's card is
            saved on {ownerName || 'the client'}'s file, add {ownerName || 'them'} again and pick
            that card. Leave it empty if {ownerName || 'the client'} pays the whole thing.
          </p>

          {draft.length > 0 && (
            <ul className="mb-3 space-y-2">
              {draft.map((p, i) => {
                const list = cards[p.client_id]
                const value = String(p.card_id || defaultCardId(list) || '')
                return (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-gray-700">{p.name}</span>
                    {!list ? (
                      <span className="text-xs text-gray-400">Loading cards…</span>
                    ) : list.length === 0 ? (
                      <span className="text-xs font-medium text-amber-700">no card on file</span>
                    ) : (
                      <select value={value} onChange={e => setCard(i, e.target.value)}
                        className="max-w-[14rem] rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs">
                        {list.map(k => (
                          <option key={k.id} value={k.id}>{cardName(k)}{k.is_default ? ' — main card' : ''}</option>
                        ))}
                      </select>
                    )}
                    <span className="w-16 text-right font-medium tabular-nums text-gray-900">
                      {draft.length > 1 ? money(shares[i]) : ''}
                    </span>
                    <button type="button" onClick={() => remove(i)} title="Remove"
                      className="px-1 text-gray-400 hover:text-red-600">×</button>
                  </li>
                )
              })}
              {draft.length > 1 && (
                <li className="flex items-baseline justify-between border-t border-gray-200 pt-1 text-sm">
                  <span className="text-gray-500">Class</span>
                  <span className="font-semibold tabular-nums text-gray-900">{money(amount)}</span>
                </li>
              )}
            </ul>
          )}

          <SearchSelect
            key={adderKey}
            options={clients}
            value={null}
            onChange={addPerson}
            clearable={false}
            placeholder={draft.length ? 'Add another person or card…' : 'Add someone…'}
          />

          {draft.length === 1 && (
            <p className="mt-2 text-xs text-amber-700">
              One card on its own isn't a split — add another, or remove this one to go back
              to {ownerName || 'the client'} paying for the whole class.
            </p>
          )}
          {dupCard && (
            <p className="mt-2 text-xs text-amber-700">The same card is on the list twice — pick a different card for one of them.</p>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={saving || draft.length === 1 || dupCard}
              onClick={() => save(draft)}
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
                  {shownCard(p)
                    ? <span className="ml-1.5 text-[11px] text-gray-500">{shownCard(p)}</span>
                    : <span className="ml-1.5 text-[11px] font-medium text-amber-700">no card on file</span>}
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
