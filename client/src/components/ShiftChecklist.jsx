import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { today } from '../utils/dates'

// The shift, as something you tick off.
//
// The steps are the ones in the handbook, in the same order, but each carries the live
// count from the page next door — so "Overdue reminders · 6 left" is a fact rather than a
// reminder to go and look. Nothing ticks itself: a step with nothing outstanding is
// suggested as done, but the person still says so, because "the list is empty" and "I
// dealt with it" aren't the same claim.
//
// Ticks live in the browser, per person, per day. It's a personal working aid, not a
// record — a second person on the same day starts with a clean list, which is what you
// want when two people share a day.

const STEPS = [
  {
    key: 'handoff',
    title: 'Read the handoff',
    detail: 'From whoever worked last. Press "Read it" so they know it landed.',
    goto: 'queue',
  },
  {
    key: 'urgent',
    title: 'Do anything marked urgent in it',
    detail: 'Straight away, before your own list.',
    goto: 'queue',
  },
  {
    key: 'mine',
    title: 'Your tasks',
    detail: 'Assigned to me. Finishing one takes you to the next.',
    goto: 'queue',
    count: c => c.myTasks,
    unit: 'task',
  },
  {
    key: 'mentions',
    title: 'Your mentions',
    detail: 'Someone needed an answer from you specifically.',
    goto: 'queue',
    count: c => c.mentions,
    unit: 'mention',
  },
  {
    key: 'reminders',
    title: 'Overdue reminders',
    detail: 'All of them. They are already late.',
    goto: 'queue',
    count: c => c.reminders,
    unit: 'reminder',
  },
  {
    key: 'anyone',
    title: 'The "Anyone" tasks',
    detail: 'Nobody’s name on these — take them once your own work is done.',
    goto: 'queue',
    count: c => c.anyone,
    unit: 'task',
  },
  {
    key: 'recruiting',
    title: 'Recruiting',
    detail: 'See what’s outstanding and whether you can move any of it along.',
    href: '/recruiting',
    count: c => c.recruiting,
    unit: 'class needing an instructor',
    units: 'classes needing an instructor',
  },
  {
    key: 'wrapup',
    title: 'Before you finish',
    detail: 'Anything still outstanding written down in the app, then write the handoff.',
    goto: 'sheet',
  },
]

export default function ShiftChecklist({ counts, onGo }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const day = today()
  const storageKey = `bgm_shift_checklist_${user?.initials || 'anon'}_${day}`

  const [done, setDone] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(done)) } catch { /* private mode */ }
  }, [storageKey, done])

  const [note, setNote]     = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]     = useState(null)
  const [error, setError]   = useState('')

  function toggle(key) {
    setDone(d => (d.includes(key) ? d.filter(k => k !== key) : [...d, key]))
  }

  const doneCount = STEPS.filter(s => done.includes(s.key)).length
  const allDone = doneCount === STEPS.length

  // Sending is what ends the shift: Sarede gets the summary and the list comes back
  // clean for whoever is on next. Deliberately allowed with steps unticked — a shift
  // that didn't get through everything is exactly what she needs to see.
  async function send() {
    setSending(true)
    setError('')
    try {
      const row = await api.sendShiftReport({
        steps: STEPS.map(s => ({ key: s.key, title: s.title, done: done.includes(s.key) })),
        counts: {
          tasks: counts.myTasks, mentions: counts.mentions,
          overdue_reminders: counts.reminders, anyone: counts.anyone,
          recruiting_unfilled: counts.recruiting,
        },
        note,
      })
      setSent(row)
      setDone([])          // renewed for the next shift
      setNote('')
    } catch (e) {
      setError(e.message || 'That didn’t send.')
    } finally { setSending(false) }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-4 space-y-2">
        <p className="text-sm font-semibold text-green-800">✓ Summary sent to Sarede</p>
        <p className="text-xs text-green-700">
          {sent.steps.filter(s => s.done).length} of {sent.steps.length} steps done. The
          checklist has been reset for the next shift.
        </p>
        <button onClick={() => setSent(null)}
          className="text-xs text-green-800 hover:underline">Back to the checklist</button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {allDone ? 'Shift complete' : `${doneCount} of ${STEPS.length} done`}
          </p>
          <p className="text-xs text-gray-500">
            Work them in order. Ticks are yours alone and clear overnight.
          </p>
        </div>
        {doneCount > 0 && (
          <button
            onClick={() => setDone([])}
            className="text-xs text-gray-400 hover:text-gray-700 hover:underline print:hidden"
          >
            Start a fresh shift
          </button>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden print:hidden">
        <div
          className="h-full bg-blue-600 transition-all duration-300"
          style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
        />
      </div>

      <ol className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {STEPS.map((step, i) => {
          const isDone = done.includes(step.key)
          const n = step.count ? step.count(counts) : null
          const clear = n === 0
          return (
            <li key={step.key} className={`flex items-start gap-3 px-4 py-3 ${isDone ? 'bg-gray-50/70' : ''}`}>
              <button
                type="button"
                onClick={() => toggle(step.key)}
                aria-pressed={isDone}
                className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                  isDone
                    ? 'bg-green-600 border-green-600 text-white'
                    : 'bg-white border-gray-300 hover:border-green-400'
                }`}
              >
                {isDone && <span className="text-xs leading-none">✓</span>}
              </button>

              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold flex flex-wrap items-center gap-2 ${
                  isDone ? 'text-gray-400 line-through' : 'text-gray-900'
                }`}>
                  <span className="text-gray-400 font-normal tabular-nums">{i + 1}.</span>
                  {step.title}
                  {n !== null && !isDone && (
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      clear ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {clear ? 'nothing left' : `${n} ${n === 1 ? step.unit : (step.units || step.unit + 's')} left`}
                    </span>
                  )}
                </p>
                {!isDone && <p className="text-xs text-gray-500 mt-0.5">{step.detail}</p>}
              </div>

              {!isDone && (
                <button
                  type="button"
                  onClick={() => (step.href ? navigate(step.href) : onGo(step.goto))}
                  className="shrink-0 text-[11px] text-blue-600 hover:underline print:hidden"
                >
                  Go →
                </button>
              )}
            </li>
          )
        })}
      </ol>

      <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-1">All shift</p>
        <p className="text-sm text-gray-700">
          Keep the <b>Waiting On</b> sheet up to date as you go. Every time you&rsquo;re waiting on
          somebody, put them on it &mdash; if you&rsquo;re matching an instructor to a client, both
          names go on one line.
        </p>
      </div>

      <div className={`rounded-xl border px-4 py-3 space-y-2 print:hidden ${
        allDone ? 'border-green-200 bg-green-50/60' : 'border-gray-200 bg-white'
      }`}>
        <p className="text-sm font-semibold text-gray-900">
          {allDone ? 'That’s the shift — send it to Sarede' : 'Finishing early?'}
        </p>
        <p className="text-xs text-gray-500">
          {allDone
            ? 'She gets what you got through and what was still outstanding. The checklist resets for the next shift.'
            : 'You can send with steps unticked — what didn’t get done is the useful part. The checklist resets after sending.'}
        </p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="Anything Sarede should know? (optional)"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={send} disabled={sending}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50 hover:bg-blue-700">
            {sending ? 'Sending…' : 'Send summary to Sarede'}
          </button>
          {!allDone && (
            <span className="text-[11px] text-gray-400">{doneCount} of {STEPS.length} ticked</span>
          )}
          {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>
        <p className="text-[11px] text-gray-400">
          If you haven&rsquo;t written the handoff yet, it&rsquo;s on the Waiting On tab.
        </p>
      </div>
    </div>
  )
}
