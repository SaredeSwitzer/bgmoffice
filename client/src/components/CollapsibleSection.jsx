import { useEffect, useState } from 'react'

// One collapsing behaviour shared by every stacked section (My Tasks, Anyone, Waiting to
// Hear Back From) so they all open, close and count the same way. Open/closed is
// remembered per section in localStorage — otherwise the thing you deliberately collapsed
// springs back open on every page load and you collapse it again forever.
export default function CollapsibleSection({
  id,                 // stable key for remembering open/closed
  title,
  count,              // shown as a pill next to the title; omit to hide
  accent = 'gray',    // left border + pill colour
  defaultOpen = true,
  right = null,       // extra controls on the header row (e.g. an "open full list" link)
  children,
}) {
  // Bump when a section's default changes, so the new default actually reaches people who
  // already have an old open/closed choice saved — otherwise the remembered value wins and
  // the change looks like it did nothing.
  const storageKey = `bgm_section_v2_${id}`
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === null ? defaultOpen : saved === '1'
    } catch { return defaultOpen }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? '1' : '0') } catch { /* private mode */ }
  }, [storageKey, open])

  const BORDER = {
    gray:   'border-gray-400',
    purple: 'border-purple-400',
    amber:  'border-amber-400',
  }[accent] || 'border-gray-400'

  const PILL = {
    gray:   'bg-gray-100 text-gray-700',
    purple: 'bg-purple-100 text-purple-700',
    amber:  'bg-amber-100 text-amber-700',
  }[accent] || 'bg-gray-100 text-gray-700'

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 group"
        >
          <span className={`text-gray-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <h2 className={`text-sm font-bold uppercase tracking-widest text-gray-500 pl-1 border-l-4 ${BORDER} group-hover:text-gray-800 transition-colors truncate`}>
            {title}
          </h2>
          {count > 0 && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${PILL}`}>{count}</span>
          )}
        </button>
        {right}
      </div>
      {open && children}
    </section>
  )
}
