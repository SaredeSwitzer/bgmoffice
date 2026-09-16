import { useEffect, useRef, useState } from 'react'

// Speak a text instead of typing it.
//
// Uses the browser's own speech recognition, so there is no service to pay for, no audio
// leaving for us to store, and nothing to set up. The catch is that not every browser has
// it: Chrome and Safari do, Firefox does not, and Brave switches it off by default because
// it routes audio to Google. So the button only appears where it will actually work —
// a mic that does nothing when pressed is worse than no mic.
//
// Dictation appends rather than replaces. You often type half a message, dictate the rest,
// or dictate twice because you paused; wiping the box in either case loses work.

function getRecognition() {
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Impl) return null
  const r = new Impl()
  r.lang = 'en-US'
  r.continuous = true
  // Interim results are what make it feel alive — the words appear as you say them
  // rather than in a lump when you stop.
  r.interimResults = true
  return r
}

export default function DictateButton({ onText, className = '' }) {
  const [supported] = useState(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition))
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef(null)
  // What has already been committed this session, so the interim rewrites don't get
  // appended twice as the engine corrects itself.
  const finalRef = useRef('')

  useEffect(() => () => { try { recRef.current?.stop() } catch { /* already stopped */ } }, [])

  function start() {
    setError('')
    const r = getRecognition()
    if (!r) return
    recRef.current = r
    finalRef.current = ''

    r.onresult = (e) => {
      let settled = ''
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript
        if (e.results[i].isFinal) settled += chunk
        else pending += chunk
      }
      if (settled) {
        finalRef.current += settled
        onText(settled, { final: true })
      } else if (pending) {
        onText(pending, { final: false })
      }
    }

    r.onerror = (e) => {
      setListening(false)
      setError(e.error === 'not-allowed'
        ? 'Your browser is blocking the microphone — allow it for this site and try again.'
        : e.error === 'no-speech' ? "Didn't catch that."
        : 'Dictation stopped.')
    }
    r.onend = () => setListening(false)

    try { r.start(); setListening(true) }
    catch { setError('Dictation could not start.') }
  }

  function stop() {
    try { recRef.current?.stop() } catch { /* already stopped */ }
    setListening(false)
  }

  if (!supported) return null

  return (
    <div className={className}>
      <button
        type="button"
        onClick={listening ? stop : start}
        title={listening ? 'Stop dictating' : 'Dictate this message'}
        aria-label={listening ? 'Stop dictating' : 'Dictate this message'}
        className={`rounded-lg border px-2.5 py-2 text-sm ${
          listening
            ? 'animate-pulse border-red-300 bg-red-50 text-red-600'
            : 'border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
      >
        {listening ? '● ' : ''}🎤
      </button>
      {error && <p className="mt-1 max-w-[220px] text-xs text-red-600">{error}</p>}
    </div>
  )
}
