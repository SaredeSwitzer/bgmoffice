import { useEffect, useRef } from 'react'

// A plain centred dialog. Used where something opened from a list has to be readable
// without hunting for it — a panel rendered under a long table is easy to miss
// entirely, which is exactly what happened with the My Tasks panels.
//
// Escape closes, clicking the backdrop closes, the page behind doesn't scroll, and the
// dialog itself scrolls when the content is long.
export default function Modal({ children, onClose, labelledBy }) {
  const cardRef = useRef(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // Stop the list behind from scrolling under the dialog.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the dialog so Escape works without clicking into it first, and so a
    // keyboard user lands inside rather than at the top of the page behind.
    cardRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-gray-900/40 backdrop-blur-[2px] overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl my-auto outline-none"
      >
        {children}
      </div>
    </div>
  )
}
