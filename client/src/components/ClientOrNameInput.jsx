import { useRef, useState } from 'react'

// A name that is often, but not always, someone we already have.
//
// Referrals are the case this was built for: most come from a current client, and picking
// that client makes the name clickable and countable ("who has sent us work"). But plenty
// come from a neighbour, a school, a doctor — people with no record here and no reason to
// have one. So this is a plain text box that happens to recognise clients: type freely, or
// take one of the suggestions to link it to their record.
//
// value: { name, id } — id is null for a name we just typed.
export default function ClientOrNameInput({
  value, onChange, clients = [], placeholder = 'Name, or how they found us', className = '',
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const name = value?.name || ''
  const matches = name.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(name.toLowerCase()) && c.id !== value?.id).slice(0, 6)
    : []

  function handleBlur(e) {
    if (!containerRef.current?.contains(e.relatedTarget)) setOpen(false)
  }

  const inputCls = className ||
    'w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <input
        value={name}
        onChange={e => { onChange({ name: e.target.value, id: null }); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className={`${inputCls} ${value?.id ? 'pr-16' : ''}`}
      />
      {/* Says which of the two this is — a linked client, or just a name. */}
      {value?.id && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <span className="text-[10px] font-semibold text-teal-600 uppercase tracking-wide">client</span>
          <button type="button" title="Keep the name, drop the link"
            onMouseDown={e => { e.stopPropagation(); onChange({ name, id: null }) }}
            className="text-[10px] text-gray-400 hover:text-red-500 leading-none px-0.5">✕</button>
        </span>
      )}

      {open && matches.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {matches.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={() => { onChange({ name: c.name, id: c.id }); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
            >
              {c.name}
              <span className="text-[10px] text-gray-400 ml-2">existing client</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
