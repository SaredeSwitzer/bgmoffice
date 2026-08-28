import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../api/client'
import WeeklyRemindersPanel from '../components/WeeklyRemindersPanel'

// Two-way SMS inbox for the BGM texting line (917-719-2201). Left: conversations. Right: the
// selected thread + a reply box. "New" opens a compose panel to text one person or send an
// announcement to everyone. Polls every 12s so new inbound texts appear without a refresh.

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return p || ''
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function SmsPage() {
  const [threads, setThreads] = useState([])
  const [active, setActive] = useState(null)       // phone string
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [composeOpen, setComposeOpen] = useState(false)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const scrollRef = useRef(null)

  const loadThreads = useCallback(async () => {
    try { setThreads(await api.smsThreads()) }
    catch { /* keep the last good list on a transient error */ }
    finally { setLoading(false) }
  }, [])

  const loadThread = useCallback(async (phone) => {
    if (!phone) return
    try {
      const { messages } = await api.smsThread(phone)
      setMessages(messages)
      setThreads((prev) => prev.map((t) => (t.phone === phone ? { ...t, unread: 0 } : t)))
    } catch (e) { setError(e.message || 'Could not load that conversation.') }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])

  useEffect(() => {
    const id = setInterval(() => {
      loadThreads()
      if (active) loadThread(active)
    }, 12000)
    return () => clearInterval(id)
  }, [active, loadThreads, loadThread])

  useEffect(() => { if (active) loadThread(active) }, [active, loadThread])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function send(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || !active || sending) return
    setSending(true)
    setError('')
    try {
      await api.smsSend(active, body)
      setDraft('')
      await loadThread(active)
      loadThreads()
    } catch (e) { setError(e.message || 'Failed to send.') }
    finally { setSending(false) }
  }

  function openThread(phone) {
    setComposeOpen(false)
    setActive(phone)
    loadThreads()
  }

  const activeThread = threads.find((t) => t.phone === active)
  const activeName = activeThread?.person_name || (active ? fmtPhone(active) : '')

  return (
    <div className="mx-auto max-w-6xl px-3 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Texts</h1>
        <button
          onClick={() => { setComposeOpen(true); setActive(null) }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          New message
        </button>
        <button
          onClick={() => { setRemindersOpen(true); setComposeOpen(false); setActive(null) }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Weekly reminders
        </button>
      </div>

      <div className="flex h-[70vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {/* Conversation list */}
        <aside className={`${active || composeOpen || remindersOpen ? 'hidden md:block' : 'block'} w-full shrink-0 overflow-y-auto border-r border-gray-200 md:w-72`}>
          {loading ? (
            <p className="p-4 text-sm text-gray-400">Loading…</p>
          ) : threads.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No texts yet.</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.phone}
                onClick={() => { setComposeOpen(false); setActive(t.phone) }}
                className={`flex w-full flex-col gap-0.5 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${active === t.phone && !composeOpen ? 'bg-blue-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-gray-900">{t.person_name || fmtPhone(t.phone)}</span>
                  <span className="shrink-0 text-xs text-gray-400">{fmtTime(t.last_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-gray-500">
                    {t.last_direction === 'outbound' ? 'You: ' : ''}{t.last_body || '(no text)'}
                  </span>
                  {Number(t.unread) > 0 && (
                    <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">{t.unread}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Right pane: compose OR conversation */}
        {remindersOpen ? (
          <section className="min-w-0 flex-1">
            <WeeklyRemindersPanel onClose={() => setRemindersOpen(false)} onSent={loadThreads} />
          </section>
        ) : composeOpen ? (
          <ComposePanel onClose={() => setComposeOpen(false)} onOpenThread={openThread} onSent={loadThreads} />
        ) : (
          <section className={`${active ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
            {!active ? (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                Pick a conversation, or start a New message.
              </div>
            ) : (
              <>
                <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
                  <button className="text-blue-600 md:hidden" onClick={() => setActive(null)}>← </button>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900">{activeName}</div>
                    <div className="text-xs text-gray-400">
                      {fmtPhone(active)}{activeThread?.person_kind ? ` · ${activeThread.person_kind}` : ''}
                    </div>
                  </div>
                </header>

                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                        m.direction === 'outbound' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-900'}`}>
                        {m.body || '(no text)'}
                        <div className={`mt-1 text-[10px] ${m.direction === 'outbound' ? 'text-blue-100' : 'text-gray-400'}`}>
                          {fmtTime(m.created_at)}{m.direction === 'outbound' && m.status ? ` · ${m.status}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {error && <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

                <form onSubmit={send} className="flex items-end gap-2 border-t border-gray-200 p-3">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
                    rows={1}
                    placeholder="Type a reply…"
                    className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <button type="submit" disabled={sending || !draft.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// ── Compose: text one person, or an announcement to an audience ───────────────────────────────
function ComposePanel({ onClose, onOpenThread, onSent }) {
  const [mode, setMode] = useState('one')          // 'one' | 'blast'
  const [contacts, setContacts] = useState([])
  const [recipient, setRecipient] = useState('')   // typed number or picked "Name — phone"
  const [audience, setAudience] = useState('clients')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState(null)   // { done, total, fails }
  const [error, setError] = useState('')

  useEffect(() => {
    api.smsContacts().then(setContacts).catch(() => setContacts([]))
  }, [])

  // Resolve the typed/picked recipient to a phone number. Accepts "Name — (xxx) xxx-xxxx" from the
  // datalist, or a raw number the user typed.
  function resolveOnePhone() {
    const val = recipient.trim()
    const match = contacts.find((c) => `${c.name} — ${fmtPhone(c.phone)}` === val || c.name === val)
    const phone = match ? match.phone : val
    return String(phone).replace(/\D/g, '').length >= 10 ? phone : null
  }

  const audienceList = contacts.filter((c) =>
    audience === 'all' ? true : audience === 'clients' ? c.kind === 'client' : c.kind === 'instructor')

  async function sendOne() {
    const phone = resolveOnePhone()
    if (!phone) { setError('Enter a valid number or pick a contact.'); return }
    if (!body.trim()) { setError('Type a message.'); return }
    setBusy(true); setError('')
    try {
      const row = await api.smsSend(phone, body.trim())
      onOpenThread(row.phone)
    } catch (e) { setError(e.message || 'Failed to send.') }
    finally { setBusy(false) }
  }

  async function sendBlast() {
    if (!body.trim()) { setError('Type a message.'); return }
    const recips = audienceList
    if (recips.length === 0) { setError('No one in that audience has a phone on file.'); return }
    setBusy(true); setError(''); setConfirming(false)
    let done = 0, fails = 0
    setProgress({ done, total: recips.length, fails })
    for (const c of recips) {
      try { await api.smsSend(c.phone, body.trim()) }
      catch { fails += 1 }
      done += 1
      setProgress({ done, total: recips.length, fails })
      await sleep(700)  // gentle pacing; Telnyx queues delivery on its side
    }
    setBusy(false)
    onSent()
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <span className="font-medium text-gray-900">New message</span>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Close</button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* mode toggle */}
        <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-sm">
          <button onClick={() => { setMode('one'); setProgress(null) }}
            className={`rounded-md px-3 py-1 ${mode === 'one' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>One person</button>
          <button onClick={() => { setMode('blast'); setProgress(null) }}
            className={`rounded-md px-3 py-1 ${mode === 'blast' ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>Announcement</button>
        </div>

        {mode === 'one' ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">To</label>
            <input
              list="sms-contacts"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Search a name, or type a number"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <datalist id="sms-contacts">
              {contacts.map((c) => (
                <option key={`${c.kind}-${c.id}`} value={`${c.name} — ${fmtPhone(c.phone)}`} />
              ))}
            </datalist>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Send to</label>
            <select value={audience} onChange={(e) => setAudience(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
              <option value="clients">All clients</option>
              <option value="instructors">All instructors</option>
              <option value="all">Everyone (clients + instructors)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">{audienceList.length} {audienceList.length === 1 ? 'person' : 'people'} with a phone on file</p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            placeholder="Type your message…"
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          <p className="mt-1 text-xs text-gray-400">People can reply STOP to opt out.</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        {progress && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Sent {progress.done} of {progress.total}{progress.fails ? ` · ${progress.fails} failed` : ''}
            {progress.done === progress.total && !busy ? ' — done.' : '…'}
          </div>
        )}
      </div>

      <footer className="border-t border-gray-200 p-3">
        {mode === 'one' ? (
          <button onClick={sendOne} disabled={busy}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Sending…' : 'Send'}
          </button>
        ) : confirming ? (
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} disabled={busy}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Cancel</button>
            <button onClick={sendBlast} disabled={busy}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Sending…' : `Yes, send to ${audienceList.length}`}
            </button>
          </div>
        ) : (
          <button onClick={() => { setError(''); if (!body.trim()) { setError('Type a message.'); return } setConfirming(true) }}
            disabled={busy || audienceList.length === 0}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Send to {audienceList.length} {audienceList.length === 1 ? 'person' : 'people'}
          </button>
        )}
      </footer>
    </section>
  )
}
