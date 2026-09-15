import { useEffect, useState } from 'react'
import { useVoice } from '../context/VoiceContext'
import { api } from '../api/client'

// The phone itself: a small bar that sits out of the way until something is happening,
// and takes over the corner when a call comes in.
//
// Sits bottom-LEFT on purpose. Amber already lives in the bottom-right corner, and a
// ringing phone that covers her — or that she covers — is the one thing here that cannot
// afford to be missed.

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return p || 'Unknown'
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

function useElapsed(running) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!running) { setSecs(0); return }
    const id = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export default function Softphone() {
  const v = useVoice()
  const [muted, setMuted] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const onCall = v?.callState === 'active'
  const elapsed = useElapsed(onCall)

  useEffect(() => { if (!onCall) setMuted(false) }, [onCall])

  if (!v) return null

  // Someone is calling. Across the top of the screen, above everything, on whatever page
  // you happen to be on.
  //
  // This used to be a small box in the bottom-left corner. It was on every page — it has
  // always been mounted outside the routed content — but a 288px card in the corner of a
  // long scrolling page is something you can genuinely fail to notice while a client waits
  // on the line. A ringing phone is the one thing in this app entitled to interrupt.
  // z-[100] clears the sticky page header, which sits at z-40.
  if (v.incoming) {
    return (
      <div className="fixed inset-x-0 top-0 z-[100] border-b-4 border-green-600 bg-green-50 shadow-2xl">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex h-3 w-3 shrink-0 animate-ping rounded-full bg-green-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-800">Incoming call</p>
            <p className="truncate text-lg font-bold text-gray-900">{fmtPhone(v.remoteNumber)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={v.answer}
              className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700">
              Answer
            </button>
            <button onClick={v.reject}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Decline
            </button>
          </div>
        </div>
      </div>
    )
  }

  // A live call stays across the top too, so hanging up never means hunting for the
  // window you started the call from.
  if (v.call) {
    return (
      <div className="fixed inset-x-0 top-0 z-[100] border-b-2 border-gray-300 bg-white shadow-lg">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {onCall ? `On a call · ${elapsed}` : 'Calling…'}
            </p>
            <p className="truncate font-bold text-gray-900">{fmtPhone(v.remoteNumber)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => { v.toggleMute(); setMuted((m) => !m) }}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                muted ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button onClick={v.hangup}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
              Hang up
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Nothing happening: just say whether this computer can be reached.
  return (
    // Column, not a row: the settings panel opens ABOVE the pill. Beside it, the panel
    // shoved the pill into the middle of the screen every time it was opened.
    // Desktop only. On a phone this pill sits exactly on top of the reply box in a text
    // conversation — the one thing you are there to use. The same control lives in the
    // mobile menu instead, where it blocks nothing.
    <div className="fixed bottom-4 left-4 z-40 hidden flex-col items-start gap-1 sm:flex">
      {settingsOpen && <PhoneSettings onClose={() => setSettingsOpen(false)} />}
      {/* Silence with no explanation is the worst version of this, so say it outright. */}
      {v.enabled && v.micBlocked && (
        <div className="mb-1 max-w-xs rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">
          Your browser is blocking the microphone, so people won’t hear you. Click the
          padlock or microphone icon in the address bar and allow the microphone for this site.
        </div>
      )}
      <div className="flex items-center gap-1">
      <button
        onClick={() => v.toggle(!v.enabled)}
        title={v.error || (v.enabled ? 'Calls can reach this computer' : 'Turn on to make and take calls here')}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${
          v.status === 'ready' ? 'border-green-200 bg-green-50 text-green-800'
          : v.status === 'connecting' ? 'border-gray-200 bg-white text-gray-500'
          : v.status === 'error' ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-gray-200 bg-white text-gray-500'}`}
      >
        <span className={`h-2 w-2 rounded-full ${
          v.status === 'ready' ? 'bg-green-500'
          : v.status === 'connecting' ? 'bg-gray-300'
          : v.status === 'error' ? 'bg-red-500' : 'bg-gray-300'}`} />
        {v.status === 'ready' ? 'Phone on'
          : v.status === 'connecting' ? 'Phone connecting…'
          : v.status === 'error' ? 'Phone problem'
          : 'Phone off'}
      </button>
      <button
        onClick={() => setSettingsOpen((o) => !o)}
        title="Where calls should reach you"
        className="rounded-full border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500 shadow-sm hover:text-gray-700"
      >
        ⚙
      </button>
      </div>
    </div>
  )
}

// Where a call should find you. Every person sets their own — an assistant going off duty
// for the afternoon should not have to ask anyone to do it for her.
function PhoneSettings({ onClose }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.voiceMe()
      .then((r) => setForm({
        cell_phone: r.cell_phone || '',
        ring_browser: r.ring_browser ?? true,
        ring_cell: r.ring_cell ?? false,
      }))
      .catch((e) => setError(e.message || 'Could not load your phone settings.'))
  }, [])

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      await api.voiceUpdateMe(form)
      setSaved(true)
    } catch (e) { setError(e.message || 'Could not save.') }
    finally { setSaving(false) }
  }

  return (
    <div className="mb-2 w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Where calls reach me</span>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">×</button>
      </div>

      {!form ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <label className="mb-1 block text-xs font-medium text-gray-600">My cell number</label>
          <input
            value={form.cell_phone}
            onChange={(e) => setForm({ ...form, cell_phone: e.target.value })}
            placeholder="(917) 555-0100"
            className="mb-3 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />

          <label className="mb-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.ring_browser}
              onChange={(e) => setForm({ ...form, ring_browser: e.target.checked })} />
            Ring this computer
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.ring_cell}
              onChange={(e) => setForm({ ...form, ring_cell: e.target.checked })} />
            Ring my cell
          </label>

          <p className="mb-3 text-xs text-gray-400">
            Both can be on. Turn both off to stop getting calls.
          </p>

          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          {saved && <p className="mb-2 text-xs text-green-700">Saved.</p>}

          <button onClick={save} disabled={saving}
            className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  )
}
