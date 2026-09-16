import { useState } from 'react'
import { useVoice } from '../context/VoiceContext'
import { api } from '../api/client'

// One Call button, two ways of connecting, and the person pressing it should not have to
// know or care which one happened.
//
// If the computer phone is on, the call goes through the browser and starts talking
// straight away. If it is not — she is on her cell, or never turned it on — we ring her
// own phone instead and connect her when she picks up. Either way the client sees the BGM
// number, never a personal one.

export default function CallButton({ phone, name, className = '' }) {
  const v = useVoice()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  if (!phone) return null

  async function call() {
    setBusy(true); setError(''); setNote('')
    try {
      if (v?.status === 'ready') {
        await v.dial(phone)
      } else {
        // Goes through the context so the call is tracked and can be hung up — the bar
        // at the top of the screen is the only way to stop this path once it is dialling.
        const r = await v.callViaMyPhone(phone, name)
        // Say what is about to happen, or a silent button followed by your own phone
        // ringing is simply confusing.
        setNote(`Ringing your phone — pick up and we'll connect you${name ? ` to ${name}` : ''}.`)
        if (!r?.ok) setError('The call could not be started.')
      }
    } catch (e) {
      setError(e.message || 'Could not place the call.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={className}>
      <button
        onClick={call}
        disabled={busy || Boolean(v?.call) || Boolean(v?.bridgedCall)}
        title={v?.status === 'ready' ? 'Call from this computer' : 'Ring my phone, then connect'}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Calling…' : '📞 Call'}
      </button>
      {/* Capped and right-aligned: this sits in a narrow header, and an uncapped line
          ran out past the edge of the panel. */}
      {note && <p className="mt-1 max-w-[220px] text-right text-xs text-gray-500">{note}</p>}
      {error && <p className="mt-1 max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  )
}
