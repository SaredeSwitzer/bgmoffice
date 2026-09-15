import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../api/client'
import WeeklyRemindersPanel from '../components/WeeklyRemindersPanel'
import { useUnreadTexts } from '../context/UnreadTextsContext'
import StartWaitingLinePrompt from '../components/StartWaitingLinePrompt'
import CallButton from '../components/CallButton'

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
  const { refresh: refreshUnread } = useUnreadTexts()
  const [threads, setThreads] = useState([])
  const [active, setActive] = useState(null)       // phone string
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // Bumped on every send, so the Waiting On offer re-asks per message rather than once.
  const [lastSentAt, setLastSentAt] = useState(0)
  // What was just sent, so the Waiting On prompt can offer to file the actual words
  // rather than making her retype them.
  const [lastSentText, setLastSentText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [composeOpen, setComposeOpen] = useState(false)
  const [remindersOpen, setRemindersOpen] = useState(false)
  // Search: the query, what came back, and the message we were sent here to read.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)   // null = not searching
  const [searching, setSearching] = useState(false)
  const [highlightId, setHighlightId] = useState(null)
  // Who the open thread is, when it was opened from search rather than from the list —
  // someone she has never texted has no row in `threads` to read a name off.
  const [activeMeta, setActiveMeta] = useState(null)
  // Texts that never arrived — shown as a banner, because a failure that only exists
  // inside one conversation is a failure nobody finds.
  const [failures, setFailures] = useState([])
  const [failuresOpen, setFailuresOpen] = useState(false)
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
      // Reading a conversation marks it read on the server, so the bell in the top bar
      // should drop straight away rather than waiting out its next poll.
      refreshUnread()
    } catch (e) { setError(e.message || 'Could not load that conversation.') }
  }, [refreshUnread])

  useEffect(() => { loadThreads() }, [loadThreads])

  useEffect(() => {
    const load = () => api.smsFailures().then(setFailures).catch(() => {})
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  // Search as she types, a beat behind so it isn't a request per keystroke.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults(null); setSearching(false); return }
    setSearching(true)
    const id = setTimeout(() => {
      api.smsSearch(q)
        .then((r) => setResults(r))
        .catch(() => setResults({ people: [], messages: [] }))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    const id = setInterval(() => {
      loadThreads()
      if (active) loadThread(active)
    }, 12000)
    return () => clearInterval(id)
  }, [active, loadThreads, loadThread])

  useEffect(() => { if (active) loadThread(active) }, [active, loadThread])

  // Normally park at the newest message. But when a search sent us to one message in
  // particular, go to that one instead — being dumped at the bottom of a two-year-old
  // conversation is the same as not having found it.
  useEffect(() => {
    if (!scrollRef.current) return
    if (highlightId) {
      const el = scrollRef.current.querySelector(`[data-msg="${highlightId}"]`)
      if (el) { el.scrollIntoView({ block: 'center' }); return }
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, highlightId])

  // The highlight is a "here it is" flash, not a permanent mark.
  useEffect(() => {
    if (!highlightId) return
    const id = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(id)
  }, [highlightId])

  async function send(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || !active || sending) return
    setSending(true)
    setError('')
    try {
      await api.smsSend(active, body)
      setDraft('')
      // Searching was how you got to this person; once you've written to them it has done
      // its job, and leaving the term in the box keeps the normal conversation list hidden
      // behind a set of results you're finished with. The conversation itself stays open —
      // and now sits at the top of the list, because you just wrote in it.
      clearSearch()
      // Having just texted them is the moment to ask whether we're waiting on a reply.
      setLastSentText(body)
      setLastSentAt(Date.now())
      await loadThread(active)
      loadThreads()
    } catch (e) { setError(e.message || 'Failed to send.') }
    finally { setSending(false) }
  }

  function openThread(phone) {
    setComposeOpen(false)
    setActive(phone)
    setActiveMeta(null)
    loadThreads()
  }

  // Opening something a search found. `meta` carries the name for people with no history
  // yet; `messageId` is the message to land on rather than the bottom of the thread.
  function openFromSearch(phone, meta, messageId) {
    setComposeOpen(false)
    setRemindersOpen(false)
    setActiveMeta(meta || null)
    setHighlightId(messageId || null)
    if (phone === active) {
      // Same conversation, different message — the thread won't reload, so nudge the
      // scroll effect by hand.
      setMessages((m) => [...m])
    } else {
      setActive(phone)
    }
  }

  function clearSearch() {
    setQuery('')
    setResults(null)
  }

  const activeThread = threads.find((t) => t.phone === active)
  const activeName = activeThread?.person_name || activeMeta?.name || (active ? fmtPhone(active) : '')
  const activeKind = activeThread?.person_kind || activeMeta?.kind || ''

  return (
    <div className="mx-auto max-w-6xl px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold text-gray-900">Texts</h1>
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

      {failures.length > 0 && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setFailuresOpen((o) => !o)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="text-sm font-semibold text-red-800">
                {failures.length} {failures.length === 1 ? 'text never arrived' : 'texts never arrived'}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-3">
              <button onClick={() => setFailuresOpen((o) => !o)} className="text-xs text-red-700 underline">
                {failuresOpen ? 'Hide' : 'Show'}
              </button>
              {/* Clears the banner only. The message keeps its "not delivered" panel in
                  the conversation, and a new failure brings this straight back. */}
              <button
                onClick={async () => { await api.smsDismissFailures().catch(() => {}); setFailures([]) }}
                title="Clears this banner. The failure stays on the message in the conversation."
                className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Seen it
              </button>
            </div>
          </div>

          {failuresOpen && (
            <ul className="mt-2 space-y-2">
              {failures.map((f) => (
                <li key={f.id} className="text-sm">
                  <button
                    onClick={() => { clearSearch(); setActiveMeta({ name: f.person_name, kind: f.person_kind, id: f.person_id }); setActive(f.phone) }}
                    className="font-medium text-red-900 underline underline-offset-2"
                  >
                    {f.person_name || fmtPhone(f.phone)}
                  </button>
                  <span className="text-red-700"> — {f.reason}</span>
                  {f.suggestion && <span className="block text-xs text-red-600">{f.suggestion}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex h-[62vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:h-[70vh]">
        {/* Conversation list */}
        <aside className={`${active || composeOpen || remindersOpen ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-gray-200 md:w-80`}>
          <div className="shrink-0 border-b border-gray-200 p-2">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search texts and contacts"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 py-2 pl-8 pr-8 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
              />
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
              {query && (
                <button onClick={clearSearch} aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {results ? (
              <SearchResults
                results={results}
                searching={searching}
                query={query}
                active={active}
                onOpen={openFromSearch}
              />
            ) : loading ? (
              <p className="p-4 text-sm text-gray-400">Loading…</p>
            ) : threads.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">No texts yet.</p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.phone}
                  onClick={() => { setComposeOpen(false); setActiveMeta(null); setHighlightId(null); setActive(t.phone) }}
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
          </div>
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
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">{activeName}</div>
                    <div className="text-xs text-gray-400">
                      {fmtPhone(active)}{activeKind ? ` · ${activeKind}` : ''}
                    </div>
                  </div>
                  {/* Texting someone and calling them are the same errand; the button for
                      it belongs where you already are, not on another screen. */}
                  <CallButton phone={active} name={activeName} className="shrink-0" />
                </header>

                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-gray-50 px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} data-msg={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                        m.direction === 'outbound' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-900'} ${
                        highlightId === m.id ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-50' : ''}`}>
                        {m.body || '(no text)'}
                        <div className={`mt-1 text-[10px] ${m.direction === 'outbound' ? 'text-blue-100' : 'text-gray-400'}`}>
                          {fmtTime(m.created_at)}{m.direction === 'outbound' && m.status ? ` · ${m.status}` : ''}
                        </div>
                        {/* A text that never arrived has to look different from one that
                            did. "delivery_failed" in grey at 10px is not a difference. */}
                        {m.status === 'delivery_failed' && (
                          <div className="mt-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-700">
                            <span className="font-semibold">Not delivered.</span>{' '}
                            {m.reason || 'The carrier wouldn’t deliver this one.'}
                            {m.suggestion ? <span className="block text-red-600">{m.suggestion}</span> : null}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {error && <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

                {/* Only after you've sent something, only for someone the app recognises,
                    and only when they have no open line already. */}
                {lastSentAt > 0 && activeThread?.person_id && activeThread?.person_kind && (
                  <StartWaitingLinePrompt
                    person={{ id: activeThread.person_id, kind: activeThread.person_kind, name: activeName }}
                    phone={active}
                    lastSent={lastSentAt}
                    lastText={lastSentText}
                  />
                )}

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

// ── Search results ────────────────────────────────────────────────────────────────────
// Two answers to two different questions, kept apart. "People" is everyone whose name or
// number matches — including people never texted before, so she can start one from here.
// "Messages" is the words themselves, newest first, each one a jump straight to that spot
// in the conversation.

// Show the matched words in bold inside the preview, so a hit in a long text is findable
// by eye. Split on the query rather than rebuilding the string, so nothing is dropped.
function Highlighted({ text, query }) {
  const q = String(query || '').trim()
  const body = String(text || '')
  if (!q) return body
  const i = body.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1) return body
  // Keep some of what came before the match, so the snippet has context rather than
  // starting mid-sentence on the word she searched for.
  const from = Math.max(0, i - 40)
  return (
    <>
      {from > 0 && '…'}
      {body.slice(from, i)}
      <mark className="rounded bg-amber-200 px-0.5 text-gray-900">{body.slice(i, i + q.length)}</mark>
      {body.slice(i + q.length)}
    </>
  )
}

function SearchResults({ results, searching, query, active, onOpen }) {
  const people = results.people || []
  const messages = results.messages || []

  if (!searching && people.length === 0 && messages.length === 0) {
    return <p className="p-4 text-sm text-gray-400">Nothing found for “{query.trim()}”.</p>
  }

  return (
    <div>
      {searching && <p className="px-4 pt-3 text-xs text-gray-400">Searching…</p>}

      {people.length > 0 && (
        <>
          <h2 className="sticky top-0 bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            People
          </h2>
          {people.map((p) => (
            <button
              key={p.norm_phone}
              onClick={() => onOpen(p.phone, { name: p.name, kind: p.person_kind, id: p.person_id })}
              className={`flex w-full flex-col gap-0.5 border-b border-gray-100 px-4 py-2.5 text-left hover:bg-gray-50 ${
                active === p.phone ? 'bg-blue-50' : ''}`}
            >
              <span className="truncate font-medium text-gray-900">{p.name || fmtPhone(p.phone)}</span>
              <span className="truncate text-xs text-gray-500">
                {fmtPhone(p.phone)}
                {p.person_kind ? ` · ${p.person_kind}` : ''}
                {' · '}
                {p.message_count > 0
                  ? `${p.message_count} ${p.message_count === 1 ? 'text' : 'texts'}`
                  : 'no texts yet'}
              </span>
            </button>
          ))}
        </>
      )}

      {messages.length > 0 && (
        <>
          <h2 className="sticky top-0 bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Messages
          </h2>
          {messages.map((m) => (
            <button
              key={m.id}
              onClick={() => onOpen(m.phone, { name: m.person_name, kind: m.person_kind, id: m.person_id }, m.id)}
              className="flex w-full flex-col gap-0.5 border-b border-gray-100 px-4 py-2.5 text-left hover:bg-gray-50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-900">
                  {m.person_name || fmtPhone(m.phone)}
                </span>
                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(m.created_at).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })}
                </span>
              </div>
              <span className="line-clamp-2 text-sm text-gray-600">
                {m.direction === 'outbound' ? 'You: ' : ''}
                <Highlighted text={m.body} query={query} />
              </span>
            </button>
          ))}
        </>
      )}
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
