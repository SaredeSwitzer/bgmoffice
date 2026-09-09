import { useEffect, useState } from 'react'
import { api } from '../api/client'

// Telling everyone a class has moved — in one press.
//
// A time change has to reach three places: the instructor's inbox (the full version, with
// the address and the rate) and both their phones. Sending only the email is how somebody
// turns up at the old time, and doing the three by hand meant three screens.
//
// Each part can be switched off, and a part with nobody to send to — a client with no
// mobile, an instructor with no email — says so rather than silently doing nothing.
const CHANNEL_LABELS = {
  email: 'Email to the instructor',
  instructor_text: 'Text to the instructor',
  client_text: 'Text to the client',
}

// One of the three notifications: a tick, who it's going to, and the message itself.
// A part with nowhere to send says why, and can't be switched on.
function Part({ on, setOn, enabled, title, to, missing, children }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${enabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled && on} disabled={!enabled}
          onChange={e => setOn(e.target.checked)} className="rounded" />
        <span className={`text-sm font-medium ${enabled ? 'text-gray-800' : 'text-gray-400'}`}>{title}</span>
        {enabled && to && <span className="text-[11px] text-gray-400 truncate">{to}</span>}
      </label>
      {!enabled && <p className="text-[11px] text-gray-500 mt-1 pl-6">{missing}</p>}
      {enabled && on && <div className="mt-2">{children}</div>}
    </div>
  )
}

export default function RescheduleAlertModal({ session, onClose, onSent }) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [instructorText, setInstructorText] = useState('')
  const [clientText, setClientText] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [textInstructor, setTextInstructor] = useState(true)
  const [textClient, setTextClient] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.getRescheduleAlertPreview(session.id)
      .then(p => {
        if (cancelled) return
        setPreview(p); setSubject(p.subject); setBody(p.body)
        setInstructorText(p.instructor_text || '')
        setClientText(p.client_text || '')
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session.id])

  const canEmail  = !!preview?.to
  const canTextIn = !!preview?.instructor_phone
  const canTextCl = !!preview?.client_phone
  const chosen = [canEmail && sendEmail, canTextIn && textInstructor, canTextCl && textClient].filter(Boolean).length

  async function send() {
    setSending(true); setError(null); setResults(null)
    try {
      const r = await api.sendRescheduleAlert(session.id, {
        subject, body,
        instructor_text: instructorText,
        client_text: clientText,
        send_email: canEmail && sendEmail,
        text_instructor: canTextIn && textInstructor,
        text_client: canTextCl && textClient,
      })
      const failed = (r.results || []).filter(x => !x.ok)
      // A partial failure stays on screen: closing on it would report "sent" for
      // somebody who never heard.
      if (failed.length) {
        setResults(r.results)
        setError(`${failed.length} of ${r.results.length} didn't go out.`)
        setSending(false)
        onSent?.(r)
        return
      }
      onSent?.(r)
      onClose()
    } catch (e) {
      setError(e.message); setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Notify instructor of change · {session.client_name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              {preview?.already_sent_at && (
                <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2">
                  Already sent {new Date(preview.already_sent_at).toLocaleDateString()} to {preview.already_sent_to}. Sending again will re-send it.
                </div>
              )}

              {/* 1 — the instructor's email, the full version */}
              <Part
                on={sendEmail} setOn={setSendEmail} enabled={canEmail}
                title="Email the instructor"
                to={canEmail ? `${preview.instructor_name} <${preview.to}>` : null}
                missing={`No email on file for ${preview?.instructor_name || 'this instructor'} — add one on their profile.`}
              >
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <p className="text-[11px] text-gray-400 mt-1">Cc: maria@bringthegymtome.com · replies go there too</p>
              </Part>

              {/* 2 — the instructor's phone */}
              <Part
                on={textInstructor} setOn={setTextInstructor} enabled={canTextIn}
                title="Text the instructor"
                to={preview?.instructor_phone}
                missing={`No mobile on file for ${preview?.instructor_name || 'this instructor'} — they'll only get the email.`}
              >
                <textarea value={instructorText} onChange={e => setInstructorText(e.target.value)} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </Part>

              {/* 3 — the client's phone. Plenty have only a landline, or nothing. */}
              <Part
                on={textClient} setOn={setTextClient} enabled={canTextCl}
                title="Text the client"
                to={preview?.client_phone}
                missing={`No mobile on file for ${preview?.client_name || 'this client'} — nothing will go to them.`}
              >
                <textarea value={clientText} onChange={e => setClientText(e.target.value)} rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </Part>

              <p className="text-[11px] text-gray-400">
                The app filled these in from the class&rsquo;s current date and time — edit anything before sending.
              </p>
            </>
          )}

          {results && (
            <ul className="text-xs space-y-1">
              {results.map(r => (
                <li key={r.channel} className={r.ok ? 'text-emerald-700' : 'text-red-600'}>
                  {r.ok ? '✓' : '✕'} {CHANNEL_LABELS[r.channel] || r.channel} — {r.to}
                  {r.error ? `: ${r.error}` : ''}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">
            {results ? 'Close' : 'Cancel'}
          </button>
          <button onClick={send} disabled={sending || chosen === 0}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
            {sending ? 'Sending…' : chosen === 0 ? 'Nothing to send' : `Send all ${chosen}`}
          </button>
        </div>
      </div>
    </div>
  )
}
