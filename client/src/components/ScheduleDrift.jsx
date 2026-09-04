import { useEffect, useState } from 'react'
import { api } from '../api/client'
import CollapsibleSection from './CollapsibleSection'

// Where a client's setup and their actual classes have come apart.
//
// The app keeps two things: the *setup* for a repeating class ("Mondays at 2:30 with
// Sharon"), which exists only to stamp out future dates, and the dated classes themselves.
// Edit the calendar and the setup doesn't follow, so it goes stale and quietly keeps
// producing dates from the old answer.
//
// An earlier version of this panel showed that as it is stored — a checkbox per field, a
// count of how many rows said what, and two competing buttons — and it was unreadable.
// This says one thing per problem in a sentence, names what it costs to leave, and offers
// the single action that fits. Whoever reads it should not have to know that two records
// exist, because that is the app's problem and not theirs.
//
// The classification lives in shapeOf: a one-off is somebody's deliberate change and wants
// leaving alone, a blank is a gap to be filled from the setup, and a whole series
// disagreeing means the setup is out of date.

// ── saying it in English ──────────────────────────────────────────────────────

// "14:30" → "2:30pm". The stored 24-hour form is not how anyone here says a class time.
function prettyTime(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''))
  if (!m) return v
  const h = Number(m[1])
  const suffix = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]}${suffix}`
}

const NOUN = {
  start_time: 'time', instructor_id: 'instructor', charge_amount: 'charge',
  instructor_pay: 'instructor pay', payment_method: 'payment method',
  duration_minutes: 'length', style: 'class style', weekday: 'day',
}

// How each field reads mid-sentence, talking about the classes themselves. Singular first:
// a one-off is the commonest row here and "1 class ahead are with" reads like a bug.
const VERB = {
  start_time:       ['is at',       'are at'],
  instructor_id:    ['is with',     'are with'],
  charge_amount:    ['charges',     'charge'],
  instructor_pay:   ['pays',        'pay'],
  payment_method:   ['is paid by',  'are paid by'],
  duration_minutes: ['is',          'are'],
  style:            ['is',          'are'],
}

function value(field, v) {
  return field === 'start_time' ? prettyTime(v) : v
}

// What goes unsaid otherwise: why a difference is worth a moment of anyone's day.
//
// The two shapes cost different things and must not borrow each other's sentence. A stale
// setup is a problem with the dates still to come; a gap is a problem with the ones already
// sitting there, and saying "new dates will keep coming out wrong" about a gap is just
// false — new dates would be fine.
function costOfStaleSetup(setupValue) {
  return `New dates will keep being made as ${setupValue}.`
}

function costOfGap(field) {
  if (field === 'payment_method') {
    return 'A class with nothing set here does not come off a package, and can be missed at billing.'
  }
  if (field === 'style') {
    return "The instructor's confirmation email has nothing to say the class is."
  }
  if (field === 'instructor_pay') return 'Those classes have no pay on them.'
  if (field === 'charge_amount')  return 'Those classes have nothing to bill.'
  return 'Those classes are missing it.'
}

// One of four stories, and it decides everything the row says and offers.
function shapeOf(row) {
  if (row.key === 'weekday') return 'wrong-day'
  if (!row.adoptable) return 'gap'          // the calendar is mostly empty here
  if (row.affected <= 2) return 'one-off'   // a substitute, a single week moved
  return 'stale-setup'                      // the series moved and the setup didn't
}

function Row({ item, row, onDone, onHidden }) {
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  const shape = shapeOf(row)
  const noun  = NOUN[row.key] || row.label.toLowerCase()
  const verb  = (VERB[row.key] || ['is', 'are'])[row.affected === 1 ? 0 : 1]
  const setupValue    = value(row.key, row.classSays)
  const calendarValue = value(row.key, row.calendarValue)
  const n = row.affected

  // "fill" and "move" push the setup's answer down onto the dates; "setup" pulls the
  // calendar's answer up. Kept explicit so the button and the call can't drift apart.
  async function act(kind) {
    setBusy(true); setError('')
    try {
      if (kind === 'setup') {
        await api.adoptScheduleFromCalendar(item.schedule_id,
          { fields: [row.key], adopt_weekday: false, dry_run: false })
      } else if (kind === 'fill') {
        await api.reconcileSchedule(item.schedule_id,
          { fields: [row.key], fix_weekday: false, dry_run: false })
      } else if (kind === 'move') {
        await api.reconcileSchedule(item.schedule_id,
          { fields: [], fix_weekday: true, dry_run: false })
      }
      onDone(row.signature, kind)
    } catch (e) {
      setError(e.message || 'That did not work.')
      setBusy(false)
    }
  }

  async function hide() {
    setBusy(true); setError('')
    try {
      await api.dismissScheduleDrift(item.schedule_id, { field: row.key, signature: row.signature })
      onHidden(row.signature)
    } catch (e) {
      setError(e.message || 'That did not work.')
      setBusy(false)
    }
  }

  let sentence, cost, action

  if (shape === 'stale-setup') {
    sentence = <>{n} of the classes ahead {verb} <b>{calendarValue}</b>, but the setup still says <b>{setupValue}</b>.</>
    cost     = costOfStaleSetup(setupValue)
    action   = { kind: 'setup', label: `Change the setup to ${calendarValue}`,
                 confirm: `Changes the setup only, to ${calendarValue}. Not one class on the calendar is touched — they already say this.` }
  } else if (shape === 'gap') {
    sentence = <>{row.blankCount} of the classes ahead {row.blankCount === 1 ? 'has' : 'have'} no {noun} set, though the setup says <b>{setupValue}</b>.</>
    cost     = costOfGap(row.key)
    action   = { kind: 'fill', label: `Set those ${row.blankCount} to ${setupValue}`,
                 confirm: `Fills in the ${noun} on ${row.blankCount} classes ahead as ${setupValue}. Classes that already happened are left as they were.` }
  } else if (shape === 'one-off') {
    sentence = <>{n} class{n === 1 ? '' : 'es'} ahead {verb} <b>{calendarValue}</b> instead of <b>{setupValue}</b>.</>
    cost     = 'That is almost always deliberate — a substitute, or one week moved. Nothing needs changing.'
    action   = null
  } else {
    sentence = <>{n} of the classes ahead are on a <b>{row.calendarSays}</b>, but this class runs on <b>{row.classSays}</b>.</>
    cost     = 'Those dates are on the wrong day of the week altogether.'
    action   = { kind: 'move', label: `Move them onto ${row.classSays}`,
                 confirm: `Takes the ${n} wrong-day dates off the calendar and lays the class back down on ${row.classSays}. Classes that already happened are left as they were.` }
  }

  return (
    <div className="py-2.5 border-t border-gray-100 first:border-t-0">
      <p className="text-[13px] text-gray-800 leading-snug">{sentence}</p>
      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{cost}</p>

      {confirm ? (
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
          <p className="text-xs text-gray-700 mb-2">{confirm.confirm}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => act(confirm.kind)} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Doing it…' : 'Yes, do it'}
            </button>
            <button onClick={() => setConfirm(null)} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {action && (
            <button onClick={() => setConfirm(action)} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {action.label}
            </button>
          )}
          <button onClick={hide} disabled={busy}
            className={action
              ? 'px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50'
              : 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'}>
            {busy ? 'Hiding…' : "It's fine — hide this"}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </div>
  )
}

function Card({ item, onGone }) {
  const [gone, setGone] = useState([])
  const [note, setNote] = useState('')

  const total = item.issues.length + (item.wrong_weekday ? 1 : 0)

  const rows = [
    ...(item.wrong_weekday ? [{
      key: 'weekday',
      signature: item.wrong_weekday.signature,
      label: 'Day',
      adoptable: true,
      blankCount: 0,
      classSays: item.wrong_weekday.expected,
      calendarSays: item.wrong_weekday.variants.map(v => v.value).join(' and '),
      calendarValue: item.wrong_weekday.variants[0]?.value,
      affected: item.wrong_weekday.affected,
    }] : []),
    ...item.issues.map(iss => ({
      key: iss.field,
      signature: iss.signature,
      label: iss.label,
      adoptable: iss.adoptable !== false,
      blankCount: iss.blank_count || 0,
      classSays: iss.schedule_value,
      calendarSays: iss.variants.map(v => v.value).join(' and '),
      calendarValue: iss.calendar_value,
      affected: iss.affected,
    })),
  ].filter(r => !gone.includes(r.signature))

  function finish(sig) {
    setGone(g => {
      const next = [...g, sig]
      if (next.length >= total) onGone(item.schedule_id)
      return next
    })
  }

  function settle(sig, kind) {
    setNote(kind === 'setup' ? 'Setup updated. Nothing on the calendar changed.'
          : kind === 'fill'  ? 'Those classes are filled in.'
          : 'Moved onto the right day.')
    finish(sig)
  }

  if (!rows.length) {
    return note ? (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">{item.client_name}</p>
        <p className="text-xs text-green-700 mt-0.5">✓ {note}</p>
      </div>
    ) : null
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 mb-1">
        <p className="text-sm font-bold text-gray-900">{item.client_name}</p>
        <span className="text-xs text-gray-500">
          {item.weekday}s{item.start_time ? ` at ${prettyTime(item.start_time)}` : ''}
          {item.instructor_name ? ` with ${item.instructor_name}` : ''}
        </span>
        {item.status !== 'active' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
            {item.status}
          </span>
        )}
      </div>
      {note && <p className="text-xs text-green-700 mb-1">✓ {note}</p>}
      {rows.map(row => (
        <Row key={row.key} item={item} row={row} onDone={settle} onHidden={finish} />
      ))}
    </div>
  )
}

// Hidden differences stay reachable. Something hidden by mistake would otherwise be gone
// for good, and that makes hiding feel risky enough that nobody uses it.
function Hidden({ onChanged }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!open) return
    api.getDismissedScheduleDrift().then(setRows).catch(() => setRows([]))
  }, [open])

  async function restore(r) {
    await api.undismissScheduleDrift(r.schedule_id, { field: r.field, signature: r.signature })
    setRows(rs => rs.filter(x => x.id !== r.id))
    onChanged()
  }

  return (
    <div className="mt-3 px-1">
      <button onClick={() => setOpen(o => !o)}
        className="text-[11px] text-gray-400 hover:text-gray-700 underline">
        {open ? 'Hide' : 'Show'} what you’ve hidden
      </button>
      {open && rows && (
        rows.length ? (
          <ul className="mt-2 space-y-1">
            {rows.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-[11px] text-gray-500">
                <span className="flex-1">
                  <span className="font-semibold text-gray-700">{r.client_name}</span> — {r.label}
                  {r.instructor_name ? ` · ${r.instructor_name}` : ''}
                </span>
                <button onClick={() => restore(r)} className="text-blue-600 hover:underline">
                  Put back
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-gray-400">Nothing hidden.</p>
        )
      )}
    </div>
  )
}

export default function ScheduleDrift({ id = 'schedule_drift', defaultOpen = false }) {
  const [data, setData]       = useState(null)
  const [gone, setGone]       = useState([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce]     = useState(0)

  useEffect(() => {
    setLoading(true)
    api.getScheduleDrift()
      .then(d => { setData(d); setGone([]) })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [nonce])

  if (loading || !data) return null
  const outstanding = data.report.filter(r => !gone.includes(r.schedule_id))

  return (
    <CollapsibleSection
      id={id} accent="amber" title="⚠ Classes that don't match their setup"
      count={outstanding.length} defaultOpen={defaultOpen}
    >
      <p className="text-xs text-gray-500 mb-3 px-1 max-w-3xl">
        Every repeating class has a <em>setup</em> — the day, time, instructor and rate it uses
        to make new dates. Change a class on the calendar and the setup doesn’t follow, so it
        can go on making new dates from the old answer. These are the ones that have come apart.
      </p>
      {outstanding.length ? (
        <div className="space-y-2">
          {outstanding.map(item => (
            <Card key={item.schedule_id} item={item}
              onGone={sid => setGone(g => [...g, sid])} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 px-1">
          Nothing to look at — every class matches its setup.
        </p>
      )}
      <Hidden onChanged={() => setNonce(n => n + 1)} />
    </CollapsibleSection>
  )
}
