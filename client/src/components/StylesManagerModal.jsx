import { useState } from 'react'
import { api } from '../api/client'

// Add/rename/delete entries in the shared class_styles list — the canonical set every
// style picker (instructor profiles, recruiting entries) pulls from. Renaming or
// deleting here also updates any instructor already tagged with that style (see
// onChanged callers), so a cleanup here doesn't leave orphaned style names hanging
// around on individual instructor profiles.
export default function StylesManagerModal({ styles, onChanged, onClose }) {
  const [editingId, setEditingId] = useState(null)
  const [editName,  setEditName]  = useState('')
  const [newName,   setNewName]   = useState('')
  const [saving,    setSaving]    = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    try {
      const s = await api.createClassStyle(newName.trim())
      onChanged([...styles, s].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
    } finally { setSaving(false) }
  }

  async function handleSaveEdit(id) {
    if (!editName.trim()) return
    const s = await api.updateClassStyle(id, editName.trim())
    onChanged(styles.map(x => x.id === id ? s : x))
    setEditingId(null)
  }

  async function handleDelete(id) {
    const style = styles.find(x => x.id === id)
    if (!confirm(`Delete "${style?.name}"? This removes it from every instructor currently tagged with it too.`)) return
    await api.deleteClassStyle(id)
    onChanged(styles.filter(x => x.id !== id))
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Manage Styles</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-400 -mt-2">Renaming or deleting a style updates it everywhere it's used, including on instructor profiles.</p>
        <div className="space-y-1.5 max-h-60 overflow-y-auto">
          {styles.map(s => editingId === s.id ? (
            <div key={s.id} className="flex gap-2">
              <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
              <button onClick={() => handleSaveEdit(s.id)}
                className="px-3 py-1 bg-gray-900 text-white text-xs rounded-lg">Save</button>
              <button onClick={() => setEditingId(null)}
                className="px-2 py-1 border border-gray-300 text-gray-500 text-xs rounded-lg">✕</button>
            </div>
          ) : (
            <div key={s.id} className="flex items-center justify-between gap-2 group">
              <span className="text-sm text-gray-800">{s.name}</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingId(s.id); setEditName(s.name) }}
                  className="text-gray-400 hover:text-blue-600 text-xs px-1">✎</button>
                <button onClick={() => handleDelete(s.id)}
                  className="text-gray-400 hover:text-red-500 text-xs px-1">✕</button>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New style…"
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          <button type="submit" disabled={saving || !newName.trim()}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-40">
            {saving ? '…' : '+ Add'}
          </button>
        </form>
      </div>
    </div>
  )
}
