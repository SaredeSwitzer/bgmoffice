import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import SearchSelect from '../components/SearchSelect'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function getColValue(entry, col) {
  if (col.field_key) {
    if (col.field_key === 'waiver_signed') return entry.waiver_signed ? 'Yes' : 'No'
    return entry[col.field_key] || ''
  }
  try {
    const extra = JSON.parse(entry.extra_data || '{}')
    return extra[col.id] || ''
  } catch { return '' }
}

// ── Notes Thread ──────────────────────────────────────────────────────────────

function NotesThread({ entryId, notes, onNotesChanged }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    try {
      const note = await api.addRecruitingNote(entryId, { text })
      onNotesChanged([...notes, note])
      setText('')
    } finally { setSaving(false) }
  }

  async function handleDelete(noteId) {
    await api.deleteRecruitingNote(entryId, noteId)
    onNotesChanged(notes.filter(n => n.id !== noteId))
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Notes</p>
      <div className="space-y-2 mb-3">
        {notes.length === 0 && (
          <p className="text-xs text-gray-400 italic">No notes yet.</p>
        )}
        {notes.map(n => (
          <div key={n.id} className="flex gap-2 group">
            <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[10px] font-semibold text-gray-500">
                  {n.author_initials} — {fmt(n.created_at)}
                </span>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >✕</button>
              </div>
              <p className="text-gray-800 whitespace-pre-wrap">{n.text}</p>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={2}
          placeholder={`Add a note… (as ${user?.initials})`}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd(e) }}
        />
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg self-end disabled:opacity-40"
        >
          {saving ? '…' : 'Add'}
        </button>
      </form>
    </div>
  )
}

// ── Entry Form (shared for create + edit) ─────────────────────────────────────

function EntryForm({ day, entry, columns, clients, onSave, onCancel }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => {
    const base = {
      day_of_week:    entry?.day_of_week    || day,
      time_slot:      entry?.time_slot      || '',
      neighborhood:   entry?.neighborhood   || '',
      style:          entry?.style          || '',
      participants:   entry?.participants   || '',
      client_name:    entry?.client_name    || '',
      client_id:      entry?.client_id      || null,
      address:        entry?.address        || '',
      phone:          entry?.phone          || '',
      waiver_signed:  entry?.waiver_signed  ? true : false,
      instructor_info: entry?.instructor_info || '',
      client_rate:    entry?.client_rate    || '',
      extra: {},
    }
    if (entry?.extra_data) {
      try { base.extra = JSON.parse(entry.extra_data) } catch {}
    }
    return base
  })
  const [clientObj, setClientObj] = useState(
    entry?.client_id ? clients.find(c => c.id === entry.client_id) || null : null
  )
  const [newClientName, setNewClientName]   = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [showNewClient, setShowNewClient]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const customCols = columns.filter(c => !c.field_key)

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })) }
  function setExtra(colId, val) { setForm(f => ({ ...f, extra: { ...f.extra, [colId]: val } })) }

  function handleClientSelect(c) {
    if (c) {
      setClientObj(c)
      setField('client_name', c.name)
      setField('client_id', c.id)
      setShowNewClient(false)
    } else {
      setClientObj(null)
      setField('client_name', '')
      setField('client_id', null)
    }
  }

  async function handleQuickAddClient(e) {
    e.preventDefault()
    if (!newClientName.trim()) return
    setSaving(true)
    try {
      const created = await api.createClient({ name: newClientName.trim(), phone: newClientPhone.trim() || null })
      setClientObj(created)
      setField('client_name', created.name)
      setField('client_id', created.id)
      setShowNewClient(false)
      setNewClientName('')
      setNewClientPhone('')
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        extra_data: Object.keys(form.extra).length ? form.extra : null,
        client_id: form.client_id || null,
      }
      delete payload.extra
      let saved
      if (entry) {
        saved = await api.updateRecruitingEntry(entry.id, payload)
      } else {
        saved = await api.createRecruitingEntry(payload)
      }
      onSave(saved)
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Day selector (only shown in create modal, not inline edit) */}
      {!entry && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Day *</label>
          <select value={form.day_of_week} onChange={e => setField('day_of_week', e.target.value)}
            className={inputCls}>
            {DAYS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
          <input value={form.time_slot} onChange={e => setField('time_slot', e.target.value)}
            placeholder="e.g. 10:00-11:00 AM" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
          <input value={form.neighborhood} onChange={e => setField('neighborhood', e.target.value)}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
          <input value={form.style} onChange={e => setField('style', e.target.value)}
            className={inputCls} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Participants & Ages</label>
          <input value={form.participants} onChange={e => setField('participants', e.target.value)}
            placeholder="e.g. 10-15 Seniors" className={inputCls} />
        </div>

        {/* Client linking */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          {showNewClient ? (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-700">Quick-add new client</p>
              <input value={newClientName} onChange={e => setNewClientName(e.target.value)}
                placeholder="Name *" className={inputCls} />
              <input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)}
                placeholder="Phone (optional)" className={inputCls} />
              <div className="flex gap-2">
                <button type="button" onClick={handleQuickAddClient} disabled={saving || !newClientName.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg disabled:opacity-40">
                  Create & Link
                </button>
                <button type="button" onClick={() => setShowNewClient(false)}
                  className="px-3 py-1.5 border border-gray-300 text-xs rounded-lg">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1">
                <SearchSelect
                  options={clients}
                  value={clientObj}
                  onChange={handleClientSelect}
                  placeholder="Search existing clients…"
                />
              </div>
              <button type="button" onClick={() => setShowNewClient(true)}
                className="px-3 py-1.5 border border-dashed border-gray-400 text-gray-500 text-xs rounded-lg hover:bg-gray-50 whitespace-nowrap">
                + New Client
              </button>
            </div>
          )}
          {!clientObj && (
            <input
              value={form.client_name}
              onChange={e => { setField('client_name', e.target.value); setField('client_id', null) }}
              placeholder="Or type client name manually"
              className={`${inputCls} mt-2`}
            />
          )}
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
          <textarea value={form.address} onChange={e => setField('address', e.target.value)}
            rows={2} className={`${inputCls} resize-none`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input value={form.phone} onChange={e => setField('phone', e.target.value)}
            className={inputCls} />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.waiver_signed}
              onChange={e => setField('waiver_signed', e.target.checked)}
              className="rounded" />
            Waiver Signed
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Instructor(s) / Rate</label>
          <input value={form.instructor_info} onChange={e => setField('instructor_info', e.target.value)}
            className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Client Rate / Payment</label>
          <input value={form.client_rate} onChange={e => setField('client_rate', e.target.value)}
            placeholder="e.g. $125" className={inputCls} />
        </div>

        {/* Custom columns */}
        {customCols.map(col => (
          <div key={col.id} className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">{col.name}</label>
            <input
              value={form.extra[col.id] || ''}
              onChange={e => setExtra(col.id, e.target.value)}
              className={inputCls}
            />
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Add Entry'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Entry Card ────────────────────────────────────────────────────────────────

function EntryCard({ entry, columns, clients, onUpdated, onDeleted }) {
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [notes,    setNotes]    = useState(entry.notes || [])

  const systemCols = columns.filter(c => c.field_key)
  const customCols = columns.filter(c => !c.field_key)

  const previewCols = systemCols.slice(0, 4) // time, neighborhood, style, participants

  function handleUpdated(updated) {
    setEditing(false)
    setNotes(updated.notes || notes)
    onUpdated(updated)
  }

  async function handleDelete() {
    if (!confirm('Delete this entry?')) return
    await api.deleteRecruitingEntry(entry.id)
    onDeleted(entry.id)
  }

  const waiver = entry.waiver_signed

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => !editing && setExpanded(e => !e)}
      >
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="text-gray-400 flex-shrink-0 w-5 text-center text-sm"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 min-w-0">
          {previewCols.map(col => (
            <div key={col.id} className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 truncate">{col.name}</p>
              <p className="text-xs text-gray-800 font-medium truncate">
                {getColValue(entry, col) || <span className="text-gray-300">—</span>}
              </p>
            </div>
          ))}
        </div>
        {/* Badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {entry.client_id && (
            <Link
              to={`/clients/${entry.client_id}`}
              onClick={e => e.stopPropagation()}
              className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 font-medium"
            >
              {entry.client_name || 'Client'}
            </Link>
          )}
          {waiver ? (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Waiver</span>
          ) : null}
          {notes.length > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {notes.length} note{notes.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4">
          {editing ? (
            <EntryForm
              day={entry.day_of_week}
              entry={entry}
              columns={columns}
              clients={clients}
              onSave={handleUpdated}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="flex justify-end gap-2 mb-3">
                <button onClick={() => setEditing(true)}
                  className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                  Edit
                </button>
                <button onClick={handleDelete}
                  className="text-xs px-3 py-1 border border-red-200 rounded-lg text-red-600 hover:bg-red-50">
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {columns.map(col => {
                  const val = getColValue(entry, col)
                  if (col.field_key === 'waiver_signed') {
                    return (
                      <div key={col.id}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{col.name}</p>
                        <p className={`text-sm font-medium ${entry.waiver_signed ? 'text-green-700' : 'text-gray-400'}`}>
                          {entry.waiver_signed ? '✓ Yes' : 'No'}
                        </p>
                      </div>
                    )
                  }
                  if (col.field_key === 'client_name') {
                    return (
                      <div key={col.id}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{col.name}</p>
                        {entry.client_id ? (
                          <Link to={`/clients/${entry.client_id}`}
                            className="text-sm font-medium text-blue-600 hover:underline">
                            {entry.client_name || '—'}
                          </Link>
                        ) : (
                          <p className="text-sm text-gray-800">{entry.client_name || '—'}</p>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div key={col.id} className={col.field_key === 'address' ? 'col-span-2' : ''}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{col.name}</p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{val || <span className="text-gray-300">—</span>}</p>
                    </div>
                  )
                })}
              </div>

              <NotesThread
                entryId={entry.id}
                notes={notes}
                onNotesChanged={setNotes}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Day Section ───────────────────────────────────────────────────────────────

function DaySection({ day, entries, columns, clients, onUpdated, onDeleted, onCreated, defaultOpen }) {
  const [open,       setOpen]       = useState(defaultOpen)
  const [addingNew,  setAddingNew]  = useState(false)

  return (
    <section>
      {/* Day header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none py-2 px-1 group"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm w-4 text-center">{open ? '▾' : '▸'}</span>
          <h2 className="text-base font-bold text-gray-800">{day}</h2>
          <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {entries.length}
          </span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); setOpen(true); setAddingNew(true) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-3 py-1 bg-gray-900 text-white rounded-lg hover:bg-gray-700"
        >
          + Add Entry
        </button>
      </div>

      {open && (
        <div className="space-y-2 mt-2 pl-4 border-l-2 border-gray-200">
          {entries.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              columns={columns}
              clients={clients}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
            />
          ))}

          {addingNew ? (
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-sm font-semibold text-gray-800 mb-3">New {day} Entry</p>
              <EntryForm
                day={day}
                columns={columns}
                clients={clients}
                onSave={entry => { onCreated(entry); setAddingNew(false) }}
                onCancel={() => setAddingNew(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setAddingNew(true)}
              className="w-full text-xs text-gray-400 hover:text-gray-700 border border-dashed border-gray-300 rounded-xl py-3 hover:bg-gray-50 transition-colors"
            >
              + Add {day} entry
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ── Column Manager ────────────────────────────────────────────────────────────

function ColumnManager({ columns, onColumnsChanged }) {
  const [show,    setShow]    = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState({}) // id -> name string

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const col = await api.addRecruitingColumn({ name: newName.trim() })
    onColumnsChanged([...columns, col])
    setNewName('')
  }

  async function handleRename(col) {
    const name = editing[col.id]
    if (!name || name === col.name) { setEditing(e => { const c = {...e}; delete c[col.id]; return c }); return }
    const updated = await api.updateRecruitingColumn(col.id, { name })
    onColumnsChanged(columns.map(c => c.id === col.id ? updated : c))
    setEditing(e => { const c = {...e}; delete c[col.id]; return c })
  }

  async function handleDelete(col) {
    if (!confirm(`Remove column "${col.name}"? This won't delete stored data.`)) return
    await api.deleteRecruitingColumn(col.id)
    onColumnsChanged(columns.filter(c => c.id !== col.id))
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShow(s => !s)}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg hover:bg-gray-50"
      >
        ⚙ Columns
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Manage Columns</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
            {columns.map(col => (
              <div key={col.id} className="flex items-center gap-2 group">
                {editing[col.id] !== undefined ? (
                  <input
                    value={editing[col.id]}
                    onChange={e => setEditing(ed => ({ ...ed, [col.id]: e.target.value }))}
                    onBlur={() => handleRename(col)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(col) }}
                    autoFocus
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs"
                  />
                ) : (
                  <span className="flex-1 text-xs text-gray-700">{col.name}</span>
                )}
                <button
                  onClick={() => setEditing(ed => ({ ...ed, [col.id]: col.name }))}
                  className="text-[10px] text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100"
                  title="Rename"
                >✎</button>
                <button
                  onClick={() => handleDelete(col)}
                  className="text-[10px] text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  title="Remove"
                >✕</button>
              </div>
            ))}
          </div>
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New column name…"
              className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
            />
            <button type="submit" disabled={!newName.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-40">
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecruitingPage() {
  const [grouped,  setGrouped]  = useState({})
  const [columns,  setColumns]  = useState([])
  const [clients,  setClients]  = useState([])
  const [query,    setQuery]    = useState('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const searchTimer = useRef(null)

  const load = useCallback((q = '') => {
    setLoading(true)
    Promise.all([api.getRecruiting(q || undefined), api.getClients()])
      .then(([data, cls]) => {
        setGrouped(data.grouped)
        setColumns(data.columns)
        setClients(cls)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function handleSearchChange(q) {
    setQuery(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(q), 250)
  }

  function handleEntryUpdated(updated) {
    setGrouped(prev => {
      const day = updated.day_of_week
      return { ...prev, [day]: prev[day].map(e => e.id === updated.id ? { ...updated, notes: e.notes } : e) }
    })
  }

  function handleEntryDeleted(id) {
    setGrouped(prev => {
      const next = {}
      DAYS.forEach(d => { next[d] = (prev[d] || []).filter(e => e.id !== id) })
      return next
    })
  }

  function handleEntryCreated(entry) {
    setGrouped(prev => ({
      ...prev,
      [entry.day_of_week]: [...(prev[entry.day_of_week] || []), entry],
    }))
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>

  const totalEntries = DAYS.reduce((n, d) => n + (grouped[d]?.length || 0), 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Recruiting</h1>
          <p className="text-xs text-gray-500 mt-0.5">{totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'} across all days</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={query}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search entries…"
              className="border border-gray-300 rounded-lg pl-8 pr-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 w-52"
            />
          </div>
          <ColumnManager columns={columns} onColumnsChanged={setColumns} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4">
          {DAYS.map(day => (
            <DaySection
              key={day}
              day={day}
              entries={grouped[day] || []}
              columns={columns}
              clients={clients}
              onUpdated={handleEntryUpdated}
              onDeleted={handleEntryDeleted}
              onCreated={handleEntryCreated}
              defaultOpen={day === 'Sunday'}
            />
          ))}
        </div>
      )}
    </div>
  )
}
