import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { TelnyxRTC } from '@telnyx/webrtc'
import { api } from '../api/client'

// Turns this browser tab into a phone on the BGM line, so calls can be made and answered
// from the computer without anything to install.
//
// Deliberately off until switched on. Registering asks for the microphone, and a
// permission box appearing on its own the first time someone opens the Clients page is
// alarming and gets denied — after which the phone quietly does not work and nobody knows
// why. The choice is remembered, so it is a once-per-computer decision, not a daily one.

const VoiceContext = createContext(null)
export const useVoice = () => useContext(VoiceContext)

const ON_KEY = 'bgm_softphone_on'

export function VoiceProvider({ children }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ON_KEY) === '1')
  const [status, setStatus] = useState('off')      // off | connecting | ready | error
  const [error, setError] = useState('')
  const [call, setCall] = useState(null)           // the live call object from the SDK
  const [callState, setCallState] = useState(null) // ringing | active | held | done
  const [remoteNumber, setRemoteNumber] = useState('')
  // Who is really calling. Every ringing leg arrives FROM the BGM number, because
  // Telnyx only dials from a number on the account — so the number alone reads as the
  // office ringing itself. The caller's name or number is carried as the display name.
  const [remoteName, setRemoteName] = useState('')
  const [incoming, setIncoming] = useState(false)
  const [micBlocked, setMicBlocked] = useState(false)
  // A call placed down the "ring my phone, then connect you" path. There is no WebRTC call
  // object for it — the two legs are Telnyx's — so it is tracked here by its id, purely so
  // the same bar can offer to end it. Without this there was nothing to press at all when
  // one rang out or reached voicemail.
  const [bridgedCall, setBridgedCall] = useState(null)   // { ccid, name, number }
  const clientRef = useRef(null)
  // Where the other person's voice actually comes out. WebRTC hands us a MediaStream and
  // nothing plays it on its own — without an audio element attached to that stream the
  // call connects perfectly and is completely silent, which is exactly how this first
  // went wrong. Created once, in code, so it cannot be lost on a re-render.
  const audioRef = useRef(null)
  if (!audioRef.current && typeof document !== 'undefined') {
    const el = document.createElement('audio')
    el.autoplay = true
    el.setAttribute('playsinline', '')   // iOS Safari plays inline rather than full-screen
    audioRef.current = el
  }

  // The sound this computer makes when somebody rings. Separate from the audio element
  // above, which carries the other person's voice — a ringing phone has to be audible
  // before there is any call audio to play at all, and without this the only sign of an
  // incoming call was a box appearing in the corner of a screen nobody was looking at.
  //
  // Reuses the ring tone already served for callers, so there is one sound and one file.
  const ringRef = useRef(null)
  if (!ringRef.current && typeof document !== 'undefined') {
    const el = document.createElement('audio')
    el.src = '/ringback.wav'
    el.loop = true
    el.preload = 'auto'
    ringRef.current = el
  }

  const startRinging = useCallback(() => {
    const el = ringRef.current
    if (!el) return
    el.currentTime = 0
    el.play().catch(() => { /* blocked until the page has been clicked; box still shows */ })
  }, [])

  const stopRinging = useCallback(() => {
    const el = ringRef.current
    if (!el) return
    el.pause()
    el.currentTime = 0
  }, [])

  // Attach the far end's audio as soon as there is any. Called on every call update
  // because the stream is not always present the instant the call object appears.
  const attachAudio = useCallback((c) => {
    const el = audioRef.current
    const stream = c?.remoteStream
    if (!el || !stream) return
    if (el.srcObject !== stream) el.srcObject = stream
    el.play().catch(() => { /* autoplay rules; the call still works once clicked */ })
  }, [])

  const teardown = useCallback(() => {
    try { clientRef.current?.disconnect() } catch { /* already gone */ }
    clientRef.current = null
    setCall(null); setCallState(null); setIncoming(false); setRemoteNumber(''); setRemoteName('')
  }, [])

  // Connect / disconnect as the switch is flipped.
  useEffect(() => {
    let cancelled = false
    if (!enabled) { teardown(); setStatus('off'); setError(''); return }

    setStatus('connecting'); setError(''); setMicBlocked(false)

    // Ask for the microphone when the phone is switched on, not when a call arrives.
    // Answering a ringing call and only then meeting a permission box is how you lose
    // the call — and if it was denied once, the box never appears again and the call is
    // simply silent with nothing to explain why. Checked here so it can be said plainly.
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => { if (!cancelled) setMicBlocked(true) })

    api.voiceToken()
      .then(({ token, caller_number }) => {
        if (cancelled) return
        const client = new TelnyxRTC({ login_token: token })
        clientRef.current = client
        client.on('telnyx.ready', () => !cancelled && setStatus('ready'))
        client.on('telnyx.error', (e) => {
          if (cancelled) return
          setStatus('error')
          setError(e?.error?.message || 'The computer phone could not connect.')
        })
        client.on('telnyx.socket.close', () => !cancelled && setStatus('off'))

        client.on('telnyx.notification', (n) => {
          if (cancelled || n.type !== 'callUpdate' || !n.call) return
          const c = n.call
          attachAudio(c)
          setCall(c)
          setCallState(c.state)
          setRemoteNumber(c.options?.remoteCallerNumber || c.options?.destinationNumber || '')
          setRemoteName(c.options?.remoteCallerName || '')
          setIncoming(c.state === 'ringing' && c.direction === 'inbound')
          if (['hangup', 'destroy'].includes(c.state)) {
            // Let go of the stream, or the next call can inherit a dead one.
            if (audioRef.current) audioRef.current.srcObject = null
            setCall(null); setCallState(null); setIncoming(false); setRemoteNumber(''); setRemoteName('')
          }
        })

        client.callerNumber = caller_number
        // Belt and braces: the SDK will also place remote audio here if it prefers to.
        client.remoteElement = audioRef.current
        client.connect()
      })
      .catch((e) => {
        if (cancelled) return
        setStatus('error')
        setError(e.message || 'The computer phone could not be set up.')
      })

    return () => { cancelled = true; teardown() }
  }, [enabled, teardown])

  // Ring while a call is waiting to be picked up, and stop the moment it is answered,
  // declined, or the caller gives up. Driven off `incoming` rather than started and
  // stopped by hand at each call site, so there is no path that leaves it ringing.
  useEffect(() => {
    if (incoming) startRinging()
    else stopRinging()
    return stopRinging
  }, [incoming, startRinging, stopRinging])

  const toggle = useCallback((on) => {
    localStorage.setItem(ON_KEY, on ? '1' : '0')
    setEnabled(on)
  }, [])

  // Place a call from this browser. The person on the other end sees the BGM number.
  const dial = useCallback(async (to) => {
    if (!clientRef.current || status !== 'ready') {
      throw new Error('Turn the computer phone on first.')
    }
    const { caller_number } = await api.voiceToken().catch(() => ({}))
    const c = clientRef.current.newCall({
      destinationNumber: String(to).replace(/[^\d+]/g, ''),
      callerNumber: caller_number || undefined,
      audio: true,
      video: false,
    })
    setCall(c)
    return c
  }, [status])

  // Ring my own phone, then connect me — used when this browser is not a phone.
  const callViaMyPhone = useCallback(async (to, name) => {
    const r = await api.voiceCall(to)
    setBridgedCall({ ccid: r.call_control_id, name: name || null, number: to })
    return r
  }, [])

  const hangupBridged = useCallback(async () => {
    const c = bridgedCall
    setBridgedCall(null)
    if (c?.ccid) await api.voiceHangup(c.ccid).catch(() => {})
  }, [bridgedCall])

  const answer = useCallback(() => { call?.answer(); setIncoming(false) }, [call])
  const hangup = useCallback(() => { call?.hangup() }, [call])
  const reject = useCallback(() => { call?.hangup(); setIncoming(false) }, [call])
  const toggleMute = useCallback(() => { call?.toggleAudioMute() }, [call])

  return (
    <VoiceContext.Provider value={{
      enabled, toggle, status, error, micBlocked,
      call, callState, incoming, remoteNumber, remoteName,
      bridgedCall, callViaMyPhone, hangupBridged,
      dial, answer, hangup, reject, toggleMute,
    }}>
      {children}
    </VoiceContext.Provider>
  )
}
