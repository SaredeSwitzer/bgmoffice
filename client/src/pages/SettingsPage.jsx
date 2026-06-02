import { useEffect, useState } from 'react'
import { api } from '../api/client'

// ── Shared ─────────────────────────────────────────────────────────────────────

function SectionHeader({ title, count }) {
  return (
    <div className="flex items-center gap-2 mb-4 pl-1 border-l-4 border-gray-300">
      <h2 className="text-sm font-bold uppercase tracking-widest text-gray-700">{title}</h2>
      {count != null && (
        <span className="text-xs font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  )
}

function InlineInput({ value, onChange, placeholder, className = '' }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 ${className}`}
    />
  )
}

// ── Color swatch picker ────────────────────────────────────────────────────────

const COLORS = ['blue','green','purple','teal','orange','pink','yellow','red','indigo','amber','slate','gray']
const COLOR_BG = {
  blue:'bg-blue-400', green:'bg-green-400', purple:'bg-purple-400', teal:'bg-teal-400',
  orange:'bg-orange-400', pink:'bg-pink-400', yellow:'bg-yellow-400', red:'bg-red-400',
  indigo:'bg-indigo-400', amber:'bg-amber-400', slate:'bg-slate-400', gray:'bg-gray-400',
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={`w-5 h-5 rounded-full ${COLOR_BG[c]} transition-transform ${
            value === c ? 'ring-2 ring-offset-1 ring-gray-700 scale-110' : 'hover:scale-110'
          }`}
        />
      ))}
    </div>
  )
}

// ── ACTION TYPES MANAGER ──────────────────────────────────────────────────────

function ActionTypesSection() {
  const [items, setItems] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', color: 'gray' })
  const [newForm, setNewForm] = useState({ name: '', color: 'gray' })
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)

  useEffect(() => {
    api.getSettingsActionTypes().then(setItems)
  }, [])

  async function handleSaveEdit(id) {
    setSaving(true)
    try {
      const item = items.find(i => i.id === id)
      const updated = await api.updateActionType(id, {
        name: editForm.name,
        color: editForm.color,
        order_index: item.order_index,
      })
      setItems(prev => prev.map(i => i.id === id ? updated : i))
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newForm.name.trim()) return
    setSaving(true)
    try {
      const created = await api.createActionType({ name: newForm.name.trim(), color: newForm.color })
      setItems(prev => [...prev, created])
      setNewForm({ name: '', color: 'gray' })
      setShowNew(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this action type? Existing action items using it will lose their type label.')) return
    await api.deleteActionType(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  // Drag-to-reorder
  function handleDragStart(index) { setDragIndex(index) }
  function handleDragOver(e, index) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const reordered = [...items]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(index, 0, moved)
    setDragIndex(index)
    setItems(reordered)
  }
  async function handleDrop() {
    setDragIndex(null)
    const payload = items.map((item, i) => ({ id: item.id, order_index: i + 1 }))
    await api.reorderActionTypes(payload)
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
      <SectionHeader title="Action Types" count={items.length} />
      <p className="text-xs text-gray-400 mb-4">Drag rows to reorder. Changes save on drop.</p>

      <div className="space-y-1 mb-4">
        {items.map((item, index) => {
          const isEditing = editingId === item.id
          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={handleDrop}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                dragIndex === index ? 'border-gray-400 bg-gray-100' : 'border-transparent hover:bg-gray-50'
              }`}
            >
              {/* Drag handle */}
              <span className="text-gray-300 cursor-grab select-none text-xs">⠿⠿</span>

              {isEditing ? (
                <div className="flex-1 space-y-2">
                  <InlineInput
                    value={editForm.name}
                    onChange={v => setEditForm(f => ({ ...f, name: v }))}
                    className="w-full"
                  />
                  <ColorPicker value={editForm.color} onChange={v => setEditForm(f => ({ ...f, color: v }))} />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(item.id)}
                      disabled={saving}
                      className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg font-medium disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 border border-gray-300 text-gray-600 text-xs rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${COLOR_BG[item.color] || 'bg-gray-400'}`} />
                  <span className="flex-1 text-sm text-gray-800 font-medium">{item.name}</span>
                  <button
                    onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, color: item.color }) }}
                    className="text-xs text-gray-400 hover:text-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      {showNew ? (
        <form onSubmit={handleCreate} className="border border-gray-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <InlineInput
              value={newForm.name}
              onChange={v => setNewForm(f => ({ ...f, name: v }))}
              placeholder="Action type name…"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
            <ColorPicker value={newForm.color} onChange={v => setNewForm(f => ({ ...f, color: v }))} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !newForm.name.trim()}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowNew(false)}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowNew(true)}
          className="w-full text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
        >
          + Add Action Type
        </button>
      )}
    </section>
  )
}

// ── DELEGATES MANAGER ─────────────────────────────────────────────────────────

function DelegatesSection() {
  const [delegates, setDelegates] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getSettingsDelegates().then(setDelegates)
  }, [])

  async function handleSaveEdit(id) {
    setSaving(true)
    try {
      const updated = await api.updateDelegate(id, { name: editName })
      setDelegates(prev => prev.map(d => d.id === id ? updated : d))
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    try {
      const created = await api.createDelegate({ name: newName.trim() })
      setDelegates(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
      setShowNew(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Remove delegate "${name}"?`)) return
    await api.deleteDelegate(id)
    setDelegates(prev => prev.filter(d => d.id !== id))
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
      <SectionHeader title="Delegates" count={delegates.length} />

      <div className="space-y-1 mb-4">
        {delegates.map(d => (
          <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
            {editingId === d.id ? (
              <div className="flex-1 flex items-center gap-2">
                <InlineInput
                  value={editName}
                  onChange={setEditName}
                  className="flex-1"
                />
                <button
                  onClick={() => handleSaveEdit(d.id)}
                  disabled={saving}
                  className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1 border border-gray-300 text-gray-600 text-xs rounded-lg"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                  {d.name.charAt(0)}
                </div>
                <span className="flex-1 text-sm font-medium text-gray-800">{d.name}</span>
                <button
                  onClick={() => { setEditingId(d.id); setEditName(d.name) }}
                  className="text-xs text-gray-400 hover:text-gray-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(d.id, d.name)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {showNew ? (
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <InlineInput
            value={newName}
            onChange={setNewName}
            placeholder="Delegate name…"
            className="flex-1"
          />
          <button type="submit" disabled={saving || !newName.trim()}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => { setShowNew(false); setNewName('') }}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowNew(true)}
          className="w-full text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
        >
          + Add Delegate
        </button>
      )}
    </section>
  )
}

// ── USERS MANAGER ─────────────────────────────────────────────────────────────

const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700',
  staff: 'bg-gray-100 text-gray-600',
}

function UsersSection() {
  const [users, setUsers] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', initials: '', email: '', password: '', role: 'staff' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getSettingsUsers().then(setUsers)
  }, [])

  async function handleSaveEdit(id) {
    setSaving(true)
    try {
      const payload = { ...editForm }
      if (!payload.password) delete payload.password
      const updated = await api.updateUser(id, payload)
      setUsers(prev => prev.map(u => u.id === id ? updated : u))
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await api.createUser(newForm)
      setUsers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewForm({ name: '', initials: '', email: '', password: '', role: 'staff' })
      setShowNew(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user) {
    const updated = await api.setUserActive(user.id, !user.active)
    setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5">
      <SectionHeader title="Users" count={users.length} />

      <div className="divide-y divide-gray-100 mb-4">
        {users.map(user => (
          <div key={user.id} className={`py-3 ${!user.active ? 'opacity-50' : ''}`}>
            {editingId === user.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <InlineInput value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Initials</label>
                    <InlineInput value={editForm.initials} onChange={v => setEditForm(f => ({ ...f, initials: v.toUpperCase().slice(0,3) }))} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <InlineInput value={editForm.email} onChange={v => setEditForm(f => ({ ...f, email: v }))} className="w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                    <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">New Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></label>
                    <InlineInput value={editForm.password || ''} onChange={v => setEditForm(f => ({ ...f, password: v }))}
                      placeholder="New password…" className="w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleSaveEdit(user.id)} disabled={saving}
                    className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-700">
                  {user.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{user.name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[user.role]}`}>
                      {user.role}
                    </span>
                    {!user.active && (
                      <span className="text-xs text-gray-400 font-medium">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setEditingId(user.id); setEditForm({ name: user.name, initials: user.initials, email: user.email, role: user.role, password: '' }) }}
                    className="text-xs text-gray-400 hover:text-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(user)}
                    className={`text-xs ${user.active ? 'text-gray-400 hover:text-amber-600' : 'text-gray-400 hover:text-green-600'}`}
                  >
                    {user.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew ? (
        <form onSubmit={handleCreate} className="border border-gray-200 rounded-xl p-4 space-y-3">
          <h4 className="text-xs font-semibold text-gray-700">New User</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <InlineInput required value={newForm.name} onChange={v => setNewForm(f => ({ ...f, name: v }))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Initials *</label>
              <InlineInput required value={newForm.initials} onChange={v => setNewForm(f => ({ ...f, initials: v.toUpperCase().slice(0,3) }))} placeholder="e.g. SS" className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <InlineInput required value={newForm.email} onChange={v => setNewForm(f => ({ ...f, email: v }))} placeholder="user@bgmoffice.com" className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select value={newForm.role} onChange={e => setNewForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
              <InlineInput required value={newForm.password} onChange={v => setNewForm(f => ({ ...f, password: v }))} placeholder="Temporary password" className="w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Creating…' : 'Create User'}
            </button>
            <button type="button" onClick={() => setShowNew(false)}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowNew(true)}
          className="w-full text-xs text-gray-500 hover:text-gray-800 border border-dashed border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
        >
          + Add User
        </button>
      )}
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>
      <ActionTypesSection />
      <DelegatesSection />
      <UsersSection />
    </div>
  )
}
