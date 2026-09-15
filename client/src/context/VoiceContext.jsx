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
  const [incoming, setIncoming] = useState(false)
  const clientRef = useRef(null)

  const teardown = useCallback(() => {
    try { clientRef.current?.disconnect() } catch { /* already gone */ }
    clientRef.current = null
    setCall(null); setCallState(null); setIncoming(false); setRemoteNumber('')
  }, [])

  // Connect / disconnect as the switch is flipped.
  useEffect(() => {
    let cancelled = false
    if (!enabled) { teardown(); setStatus('off'); setError(''); return }

    setStatus('connecting'); setError('')
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
          setCall(c)
          setCallState(c.state)
          setRemoteNumber(c.options?.remoteCallerNumber || c.options?.destinationNumber || '')
          setIncoming(c.state === 'ringing' && c.direction === 'inbound')
          if (['hangup', 'destroy'].includes(c.state)) {
            setCall(null); setCallState(null); setIncoming(false); setRemoteNumber('')
          }
        })

        client.callerNumber = caller_number
        client.connect()
      })
      .catch((e) => {
        if (cancelled) return
        setStatus('error')
        setError(e.message || 'The computer phone could not be set up.')
      })

    return () => { cancelled = true; teardown() }
  }, [enabled, teardown])

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

  const answer = useCallback(() => { call?.answer(); setIncoming(false) }, [call])
  const hangup = useCallback(() => { call?.hangup() }, [call])
  const reject = useCallback(() => { call?.hangup(); setIncoming(false) }, [call])
  const toggleMute = useCallback(() => { call?.toggleAudioMute() }, [call])

  return (
    <VoiceContext.Provider value={{
      enabled, toggle, status, error,
      call, callState, incoming, remoteNumber,
      dial, answer, hangup, reject, toggleMute,
    }}>
      {children}
    </VoiceContext.Provider>
  )
}
