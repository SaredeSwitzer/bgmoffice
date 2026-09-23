import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

// How many texts are waiting, known everywhere in the app.
//
// A reply used to arrive silently: unless you happened to be on the Texts screen you had
// no way of knowing somebody had written back. The count lives behind the whole signed-in
// app so the bell in the top bar can show it from any page, and — since 2026-09-15 — so a
// new text can make a sound wherever you are.
//
// Polled rather than pushed. A real-time connection is a lot of machinery for "somebody
// texted". It checks more often while you are actually looking at the tab, and backs off
// when you are not, because a chime you are not there to hear is only a waste.
const POLL_VISIBLE_MS = 25_000
const POLL_HIDDEN_MS = 60_000

const SOUND_KEY = 'bgm_text_sound'

const UnreadTextsContext = createContext({
  unread: 0, threads: 0, refresh: () => {}, soundOn: true, toggleSound: () => {},
})

// A short two-note chime, synthesised rather than loaded from a file — no asset to ship,
// nothing to fail to download, and it stays soft rather than sounding like an alarm.
// Deliberately gentle: this goes off in a room where people are working.
//
// The audio context is made once and kept, not made per chime. Browsers start it
// "suspended" and refuse to make any sound until the page has been interacted with, so a
// fresh context created at the moment a text arrives is silent — the code runs, no sound
// comes out, and nothing reports a problem. Instead we make it up front and resume it on
// the first click or keypress anywhere in the app, after which it stays unlocked.
let audioCtx = null
function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) audioCtx = new Ctx()
  return audioCtx
}

// Any interaction at all counts as permission, and staff click constantly — so by the
// time a text lands the sound is almost always already unlocked.
function unlockAudio() {
  const ctx = getAudioContext()
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
}

function playChime() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    // Still suspended means nobody has touched the page yet. Ask, then play — if the ask
    // is refused the notes simply go nowhere, which is the old behaviour and harmless.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    const now = ctx.currentTime
    const notes = [[880, 0], [1174.66, 0.12]]   // A5 then D6
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // Fade in and out, or it clicks at both ends.
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(now + at); osc.stop(now + at + 0.3)
    }
  } catch {
    // Never worth an error on screen. The bell still shows the count either way.
  }
}

export function UnreadTextsProvider({ children }) {
  const [state, setState] = useState({ unread: 0, threads: 0 })
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(SOUND_KEY) !== 'off')

  // The newest text we have already seen come in — read or not, since someone else's open
  // Texts screen may have marked it read before this poll. Compared on timestamp rather
  // than on the count, because reading one text while another arrives leaves the count
  // unchanged — and that new text should still make a sound.
  const lastLatest = useRef(null)
  const primed = useRef(false)
  const soundRef = useRef(soundOn)
  soundRef.current = soundOn

  const refresh = useCallback(() => {
    api.smsUnreadCount()
      .then(r => {
        setState({ unread: r?.unread || 0, threads: r?.threads || 0 })

        const latest = r?.latest || null
        // The first answer after loading the page only establishes where we are. Without
        // this, opening the app with anything unread would chime immediately, every time.
        if (!primed.current) {
          primed.current = true
          lastLatest.current = latest
          return
        }
        if (latest && latest !== lastLatest.current) {
          const isNewer = !lastLatest.current || new Date(latest) > new Date(lastLatest.current)
          lastLatest.current = latest
          if (isNewer && soundRef.current) playChime()
        }
      })
      .catch(() => {})
  }, [])

  // Take the first click or keypress as permission to make sound later.
  useEffect(() => {
    const opts = { once: true, capture: true }
    document.addEventListener('pointerdown', unlockAudio, opts)
    document.addEventListener('keydown', unlockAudio, opts)
    return () => {
      document.removeEventListener('pointerdown', unlockAudio, opts)
      document.removeEventListener('keydown', unlockAudio, opts)
    }
  }, [])

  useEffect(() => {
    refresh()
    let timer
    const schedule = () => {
      clearInterval(timer)
      timer = setInterval(refresh, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS)
    }
    schedule()
    const onFocus = () => refresh()
    const onVisibility = () => { schedule(); if (!document.hidden) refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      const next = !on
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off')
      // Play it when switching on, so it is obvious what was just turned on — and so the
      // click itself unlocks audio in browsers that need a gesture first.
      if (next) playChime()
      return next
    })
  }, [])

  return (
    <UnreadTextsContext.Provider value={{ ...state, refresh, soundOn, toggleSound }}>
      {children}
    </UnreadTextsContext.Provider>
  )
}

export const useUnreadTexts = () => useContext(UnreadTextsContext)
