import { useState, useRef, useEffect, useCallback } from 'react'

const AMBER_BASE = import.meta.env.VITE_AMBER_URL || 'https://amber.bgmoffice.com'
const AMBER_API = AMBER_BASE + '/api/chat'
const AMBER_IMG = AMBER_BASE + '/amber.png'

const QUICK_ACTIONS = [
  { label: '📋 Weekly Run',      prompt: 'weekly run' },
  { label: '👥 Clients',         prompt: 'Give me a quick summary of my active clients' },
  { label: '📂 Open Cases',      prompt: 'Show me all open cases' },
  { label: '💳 Unpaid Invoices', prompt: 'Show me all unpaid invoices' },
  { label: '🔔 Reminders',       prompt: 'What reminders do I have coming up?' },
]

function AmberAvatar({ className, style }) {
  return (
    <img
      src={AMBER_IMG}
      alt="Amber"
      className={className}
      style={{ objectFit: 'cover', objectPosition: 'center 44%', ...style }}
    />
  )
}

export default function AmberChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const sendMessage = useCallback(async (text) => {
    const userMsg = text.trim()
    if (!userMsg || streaming) return

    const newMessages = [...messages, { role: 'user', content: userMsg }]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch(AMBER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      })

      if (!res.ok || !res.body) throw new Error('Failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const { delta } = JSON.parse(data)
              if (delta) {
                assistantText += delta
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                  return updated
                })
              }
            } catch {}
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }, [messages, streaming])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <>
      {/* Floating avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full overflow-hidden shadow-lg border-2 border-purple-400 hover:scale-105 transition-transform"
        title="Chat with Amber"
      >
        <AmberAvatar className="w-full h-full" />
        {!open && (
          <span className="absolute inset-0 rounded-full border-2 border-purple-400 animate-ping opacity-50" />
        )}
      </button>

      {/* Chat panel */}
      <div
        className={`fixed bottom-0 right-0 z-50 flex flex-col bg-[#0f0e1a] border border-[#2a2845] rounded-tl-2xl shadow-2xl transition-all duration-300 ease-in-out ${
          open ? 'w-96 h-[600px] opacity-100' : 'w-0 h-0 opacity-0 pointer-events-none'
        }`}
        style={{ maxWidth: '100vw', maxHeight: '90vh' }}
      >
        {open && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2845] shrink-0">
              <div className="w-9 h-9 rounded-full overflow-hidden border border-[#2a2845] shrink-0">
                <AmberAvatar className="w-full h-full" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-none">Amber</p>
                <p className="text-[#6b6890] text-xs mt-0.5">BTGM Assistant</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Open in new tab */}
                <a
                  href={AMBER_BASE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#4a4770] hover:text-[#6B5CF5] transition-colors"
                  title="Open Amber in new tab"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="text-[#4a4770] hover:text-[#6B5CF5] text-xs transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-[#4a4770] hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-[#4a4770] px-4">
                  <p className="text-2xl mb-2">👋</p>
                  <p className="text-xs">Hi Sarede! Ask me anything about your business, or tap a quick action.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full overflow-hidden mr-1.5 mt-0.5 shrink-0 border border-[#2a2845]">
                        <AmberAvatar className="w-full h-full" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#6B5CF5] text-white rounded-br-sm'
                          : 'bg-[#1e1c38] border border-[#2a2845] text-[#d0cef0] rounded-bl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}

              {streaming && (
                <div className="flex justify-start">
                  <div className="w-6 h-6 rounded-full overflow-hidden mr-1.5 mt-0.5 shrink-0 border border-[#2a2845]">
                    <AmberAvatar className="w-full h-full" />
                  </div>
                  <div className="bg-[#1e1c38] border border-[#2a2845] px-3 py-2 rounded-xl rounded-bl-sm flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6B5CF5] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6B5CF5] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6B5CF5] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Quick actions */}
            <div className="px-3 pb-1 flex flex-wrap gap-1 shrink-0">
              {QUICK_ACTIONS.map(a => (
                <button
                  key={a.label}
                  onClick={() => sendMessage(a.prompt)}
                  disabled={streaming}
                  className="px-2 py-1 rounded-lg bg-[#1e1c38] border border-[#2a2845] text-[10px] text-[#c0bde0] hover:border-[#6B5CF5] hover:text-white transition-all disabled:opacity-40"
                >
                  {a.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="px-3 pb-3 pt-1 shrink-0">
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message Amber…"
                  rows={1}
                  disabled={streaming}
                  className="flex-1 bg-[#1e1c38] border border-[#2a2845] rounded-xl px-3 py-2 text-xs text-white placeholder-[#4a4770] resize-none focus:outline-none focus:border-[#6B5CF5] transition-colors disabled:opacity-50"
                  style={{ maxHeight: 80 }}
                  onInput={e => {
                    e.target.style.height = 'auto'
                    e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'
                  }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || streaming}
                  className="bg-[#6B5CF5] hover:bg-[#5a4de0] disabled:opacity-40 text-white rounded-xl px-3 py-2 text-xs font-medium transition-colors shrink-0"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
