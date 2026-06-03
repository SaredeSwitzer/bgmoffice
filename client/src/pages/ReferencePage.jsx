import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── Simple rich-text toolbar + textarea ──────────────────────────────────────
// We keep it dependency-free: plain <textarea> with a lightweight Markdown
// preview toggle. Admins write in plain text / Markdown; everyone reads the
// formatted result.

function MarkdownPreview({ text }) {
  // Very lightweight renderer — handles bold, italic, headings, bullets, line-breaks
  function parse(raw) {
    return raw
      // Escape HTML
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Headings
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-gray-800 mt-4 mb-1">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-gray-900 mt-5 mb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-5 mb-2">$1</h1>')
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Unordered lists (lines starting with - or *)
      .replace(/^[-•] (.+)$/gm, '<li class="ml-5 list-disc text-gray-700">$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li class="ml-5 list-decimal text-gray-700">$1</li>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr class="my-3 border-gray-200" />')
      // Paragraphs / line breaks
      .replace(/\n\n+/g, '</p><p class="text-gray-700 leading-relaxed mb-2">')
      .replace(/\n/g, '<br />')
  }

  const html = `<p class="text-gray-700 leading-relaxed mb-2">${parse(text || '')}</p>`

  return (
    <div
      className="prose-sm max-w-none text-sm text-gray-700"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ── Section editor (used for both create and edit) ────────────────────────────

function SectionEditor({ initial, onSave, onCancel, saving }) {
  const [title, setTitle]     = useState(initial?.title   ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const titleRef = useRef(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), content })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
          Section Title
        </label>
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Price List, Company Policies…"
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
          Content
          <span className="ml-2 font-normal normal-case text-gray-400">(Markdown supported — **bold**, *italic*, ## Heading, - list)</span>
        </label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Write the section content here…"
          rows={8}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300 resize-y"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Section'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Individual section card ────────────────────────────────────────────────────

function SectionCard({ section, isAdmin, onUpdated, onDeleted }) {
  const [open, setOpen]       = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [preview, setPreview] = useState(true)

  async function handleSave(data) {
    setSaving(true)
    try {
      const updated = await api.updateReferenceSection(section.id, {
        ...data,
        display_order: section.display_order,
      })
      onUpdated(updated)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${section.title}"? This cannot be undone.`)) return
    await api.deleteReferenceSection(section.id)
    onDeleted(section.id)
  }

  const fmtDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => !editing && setOpen(o => !o)}
      >
        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>

        <h3 className="flex-1 text-base font-semibold text-gray-900">{section.title}</h3>

        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-gray-400 mr-2 hidden sm:block">
            Updated {fmtDate(section.updated_at)}
          </span>
          {isAdmin && (
            <>
              <button
                onClick={() => { setEditing(v => !v); setOpen(true) }}
                className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                className="px-2.5 py-1 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {editing ? (
            <div className="mt-4">
              {/* Preview toggle inside editor */}
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setPreview(false)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${!preview ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(true)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${preview ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  Preview
                </button>
              </div>
              <SectionEditor
                initial={section}
                onSave={handleSave}
                onCancel={() => setEditing(false)}
                saving={saving}
              />
            </div>
          ) : (
            <div className="mt-4">
              {section.content ? (
                <MarkdownPreview text={section.content} />
              ) : (
                <p className="text-sm text-gray-400 italic">No content yet.</p>
              )}
              <p className="text-xs text-gray-400 mt-4 sm:hidden">
                Updated {fmtDate(section.updated_at)} · Added by {section.created_by}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReferencePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [sections, setSections] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [search, setSearch]     = useState('')

  useEffect(() => {
    api.getReference()
      .then(setSections)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd(data) {
    setSaving(true)
    try {
      const created = await api.createReferenceSection(data)
      setSections(prev => [...prev, created])
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  function handleUpdated(updated) {
    setSections(prev => prev.map(s => s.id === updated.id ? updated : s))
  }

  function handleDeleted(id) {
    setSections(prev => prev.filter(s => s.id !== id))
  }

  const filtered = search.trim()
    ? sections.filter(s =>
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.content.toLowerCase().includes(search.toLowerCase())
      )
    : sections

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Loading…</div>
  )

  if (error) return <p className="text-red-600 text-sm">{error}</p>

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reference</h1>
          <p className="text-sm text-gray-500 mt-0.5">Internal handbook — policies, pricing, and guidelines.</p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors self-start sm:self-auto"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Section
          </button>
        )}
      </div>

      {/* Search */}
      {sections.length > 2 && (
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reference…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
        </div>
      )}

      {/* New section form */}
      {adding && (
        <div className="bg-white rounded-xl border border-gray-300 shadow-sm px-5 py-5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">New Section</h2>
          <SectionEditor
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Sections list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          {search ? (
            <p className="text-gray-400 text-sm">No sections match "<strong>{search}</strong>".</p>
          ) : (
            <div className="space-y-2">
              <p className="text-4xl">📖</p>
              <p className="text-gray-500 font-medium">No reference sections yet.</p>
              <p className="text-sm text-gray-400">Click "Add Section" to create your team's first handbook entry.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(section => (
            <SectionCard
              key={section.id}
              section={section}
              isAdmin={isAdmin}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {search && filtered.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {filtered.length} of {sections.length} sections
        </p>
      )}
    </div>
  )
}
