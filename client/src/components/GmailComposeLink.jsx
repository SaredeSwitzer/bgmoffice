import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'bgm_gmail_accounts'
const LAST_KEY    = 'bgm_gmail_last_sender'

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

export default function GmailComposeLink({ to, children, className, stopPropagation }) {
  const [open,     setOpen]     = useState(false)
  const [accounts, setAccounts] = useState(loadAccounts)
  const [newAddr,  setNewAddr]  = useState('')
  const [lastUsed, setLastUsed] = useState(() => localStorage.getItem(LAST_KEY) || '')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleClick(e) {
    if (stopPropagation) e.stopPropagation()
    e.preventDefault()
    setOpen(o => !o)
  }

  function openGmail(sender) {
    localStorage.setItem(LAST_KEY, sender)
    setLastUsed(sender)
    const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(sender)}&view=cm&fs=1&to=${encodeURIComponent(to)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  function addAccount(e) {
    e.preventDefault()
    const addr = newAddr.trim()
    if (!addr || accounts.includes(addr)) { setNewAddr(''); return }
    const next = [...accounts, addr]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setAccounts(next)
    setNewAddr('')
    openGmail(addr)
  }

  function removeAccount(addr) {
    const next = accounts.filter(a => a !== addr)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setAccounts(next)
    if (lastUsed === addr) {
      localStorage.removeItem(LAST_KEY)
      setLastUsed('')
    }
  }

  return (
    <span className="relative inline-block" ref={ref}>
      <button type="button" onClick={handleClick} className={className}>
        {children || to}
      </button>

      {open && (
        <div className="absolute z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 w-64 top-6 left-0 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Send from which Gmail account?</p>

          {accounts.length > 0 ? (
            <div className="space-y-1">
              {accounts.map(addr => (
                <div key={addr} className="flex items-center gap-1 group">
                  <button
                    onClick={() => openGmail(addr)}
                    className={`flex-1 text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors truncate ${
                      addr === lastUsed
                        ? 'bg-blue-50 text-blue-800 font-medium border border-blue-200'
                        : 'hover:bg-gray-100 text-gray-700 border border-transparent'
                    }`}
                  >
                    {addr === lastUsed && <span className="mr-1 text-blue-400">✓</span>}
                    {addr}
                  </button>
                  <button
                    onClick={() => removeAccount(addr)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs px-1 flex-shrink-0 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No accounts saved yet.</p>
          )}

          <form onSubmit={addAccount} className="flex gap-1 pt-1 border-t border-gray-100">
            <input
              value={newAddr}
              onChange={e => setNewAddr(e.target.value)}
              placeholder="Add Gmail account…"
              type="email"
              autoFocus={accounts.length === 0}
              className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs min-w-0"
            />
            <button type="submit" disabled={!newAddr.trim()}
              className="px-2 py-1 bg-gray-900 text-white text-xs rounded-lg disabled:opacity-40 flex-shrink-0">
              +
            </button>
          </form>
        </div>
      )}
    </span>
  )
}
