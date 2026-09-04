import { useEffect, useState } from 'react'
import { api } from '../api/client'
import CollapsibleSection from './CollapsibleSection'

// Where a recurring class and the dated classes on the calendar have come apart.
//
// Deliberately not automatic. A difference is often meant — a substitute for one week,
// a different rate for one date — so this shows what disagrees and lets someone decide,
// with a preview before anything is written.
//
// Which side is right is not assumed. The calendar is the record staff actually keep
// current, so a disagreement usually means the recurring class has gone stale, and
// "the calendar is right" is offered first and reads as the ordinary answer. Pushing the
// class down onto the calendar is the second option, for when a change to the class
// genuinely never reached the dates.
//
// Anything can also just be hidden. Without that, a change made on purpose gets raised
// again every single week and the whole panel turns into noise that gets ignored.

function Card({ item, onGone }) {
  const [picked, setPicked]   = useState([])
  const [preview, setPreview] = useState(null)   // { direction, data }
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState(null)
  const [hidden, setHidden]   = useState([])     // signatures dismissed in this session

  const rows = [
    ...(item.wrong_weekday ? [{
      key: 'weekday',
      signature: item.wrong_weekday.signature,
      label: 'Day',
      adoptable: true,
      blankCount: 0,
      classSays: item.wrong_weekday.expected,
      calendarSays: item.wrong_weekday.variants.map(v => `${v.count} on ${v.value}`).join(', '),
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
      calendarSays: iss.variants.map(v => `${v.count} say ${v.value}`).join(' and '),
      calendarValue: iss.calendar_value,
      affected: iss.affected,
    })),
  ].filter(r => !hidden.includes(r.signature))

  const nothingPicked = picked.length === 0
  const labelOf   = Object.fromEntries(rows.map(r => [r.key, r.label]))
  // Copying a blank up would erase the last good value, so those fields can only be
  // fixed in the other direction.
  const blockedByBlank = picked.filter(k => rows.find(r => r.key === k && !r.adoptable))

  function toggle(key) {
    setPreview(null)
    setPicked(p => (p.includes(key) ? p.filter(f => f !== key) : [...p, key]))
  }

  // Both directions take the same picked list; only the endpoint and the wording differ.
  async function run(direction, dryRun) {
    setBusy(true); setError('')
    const fields = picked.filter(f => f !== 'weekday')
    const touchesDay = picked.includes('weekday')
    try {
      const res = direction === 'adopt'
        ? await api.adoptScheduleFromCalendar(item.schedule_id,
            { fields, adopt_weekday: touchesDay, dry_run: dryRun })
        : await api.reconcileSchedule(item.schedule_id,
            { fields, fix_weekday: touchesDay, dry_run: dryRun })
      if (dryRun) setPreview({ direction, data: res })
      else { setDone({ direction, data: res }); onGone(item.schedule_id) }
    } catch (e) {
      setError(e.message || 'That did not work.')
    } finally { setBusy(false) }
  }

  async function hide(row) {
    setBusy(true); setError('')
    try {
      await api.dismissScheduleDrift(item.schedule_id,
        { field: row.key, signature: row.signature })
      setPicked(p => p.filter(f => f !== row.key))
      setPreview(null)
      setHidden(h => [...h, row.signature])
      if (rows.length === 1) onGone(item.schedule_id)
    } catch (e) {
      setError(e.message || 'That did not work.')
    } finally { setBusy(false) }
  }

  async function hideAll() {
    setBusy(true); setError('')
    try {
      for (const r of rows) {
        await api.dismissScheduleDrift(item.schedule_id, { field: r.key, signature: r.signature })
      }
      onGone(item.schedule_id)
    } catch (e) {
      setError(e.message || 'That did not work.')
      setBusy(false)
    }
  }

  if (done) {
    const { direction, data } = done
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">{item.client_name}</p>
        <p className="text-xs text-green-700 mt-0.5">
          {direction === 'adopt'
            ? `✓ The recurring class now matches the calendar. Nothing on the calendar changed.`
            : `✓ Updated ${data.updated} class${data.updated === 1 ? '' : 'es'}` +
              (data.removed ? `, moved ${data.removed} onto the right day (${data.regenerated} put back)` : '') + '.'}
        </p>
      </div>
    )
  }

  if (!rows.length) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
        <p className="text-sm font-semibold text-gray-900">{item.client_name}</p>
        <span className="text-xs text-gray-500">
          {item.weekday} {item.start_time}
          {item.instructor_name ? ` · ${item.instructor_name}` : ''}
        </span>
        <span className="text-[11px] text-gray-400">{item.future_sessions} classes ahead</span>
        {item.status !== 'active' && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
            {item.status}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {rows.map(row => (
          <div key={row.key} className="flex items-start gap-2">
            <label className="flex items-start gap-2 text-xs cursor-pointer flex-1">
              <input type="checkbox" checked={picked.includes(row.key)}
                onChange={() => toggle(row.key)} className="mt-0.5 accent-blue-600" />
              <span>
                <span className="font-semibold text-gray-700">{row.label}:</span>{' '}
                the calendar says <span className="font-semibold">{row.calendarSays}</span>,
                but the recurring class says <span className="font-semibold">{row.classSays}</span>.
                {/* One or two classes out of step is somebody's deliberate change for one
                    week, not a stale record — changing the recurring class over it would
                    make a substitute permanent. */}
                {row.affected <= 2 && (
                  <span className="block text-gray-400 mt-0.5">
                    Only {row.affected} class{row.affected === 1 ? '' : 'es'} — this is usually
                    a one-off (a substitute, a single week moved). Hide it rather than change
                    the recurring class.
                  </span>
                )}
                {!row.adoptable && (
                  <span className="block text-amber-600 mt-0.5">
                    The calendar is simply blank here on {row.blankCount} class
                    {row.blankCount === 1 ? '' : 'es'} — that's a gap, not an answer, so there's
                    nothing to copy up. Filling them in from the class is the fix.
                  </span>
                )}
              </span>
            </label>
            <button onClick={() => hide(row)} disabled={busy}
              title="Hide this — it's meant to be this way"
              className="text-[11px] text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded disabled:opacity-40 shrink-0">
              Hide
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {!preview ? (
          <>
            <button onClick={() => run('adopt', true)}
              disabled={busy || nothingPicked || blockedByBlank.length > 0}
              title={blockedByBlank.length
                ? 'The calendar is blank on those — there is nothing to copy up'
                : 'Update the recurring class to match the calendar'}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {busy ? 'Checking…' : 'The calendar is right'}
            </button>
            <button onClick={() => run('reconcile', true)} disabled={busy || nothingPicked}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              The recurring class is right
            </button>
            <button onClick={hideAll} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              Hide all of these
            </button>
          </>
        ) : preview.direction === 'adopt' ? (
          <>
            <span className="text-xs text-gray-600">
              {Object.keys(preview.data.changes || {}).length ? (
                <>
                  Changes the recurring class so next time it makes dates, it makes them right:
                  <span className="block mt-0.5">
                    {Object.entries(preview.data.changes).map(([field, c]) => (
                      <span key={field} className="block">
                        <span className="font-semibold">{labelOf[field] || field}</span>:{' '}
                        {c.from === null || c.from === '' ? 'blank' : String(c.from)} →{' '}
                        <span className="font-semibold">{c.to === null ? 'blank' : String(c.to)}</span>
                        <span className="text-gray-400"> ({c.agreed_by} classes ahead already say so)</span>
                      </span>
                    ))}
                  </span>
                  <span className="block text-gray-400 mt-0.5">
                    No class on the calendar is touched — they already say this.
                  </span>
                </>
              ) : (
                'Nothing to change — the classes ahead don’t agree on one answer, so pick a side by hand.'
              )}
            </span>
            <button onClick={() => run('adopt', false)}
              disabled={busy || !Object.keys(preview.data.changes || {}).length}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              {busy ? 'Applying…' : 'Do it'}
            </button>
            <button onClick={() => setPreview(null)} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              Back
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-600">
              Changes {preview.data.updated} class{preview.data.updated === 1 ? '' : 'es'} on the calendar
              {preview.data.removed ? `, and moves ${preview.data.removed} onto the right day` : ''}.
            </span>
            <button onClick={() => run('reconcile', false)} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Applying…' : 'Do it'}
            </button>
            <button onClick={() => setPreview(null)} disabled={busy}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              Back
            </button>
          </>
        )}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  )
}

// Hidden differences stay reachable. Something hidden by mistake, or a decision that
// later turns out to have been wrong, would otherwise be gone with no way back.
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
        {open ? 'Hide' : 'Show'} the differences you’ve hidden
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

  // Still render when everything is handled, so the way back to hidden items doesn't
  // disappear along with the last card.
  return (
    <CollapsibleSection
      id={id} accent="amber" title="⚠ Calendar doesn't match the class"
      count={outstanding.length} defaultOpen={defaultOpen}
    >
      <p className="text-xs text-gray-500 mb-3 px-1 max-w-3xl">
        A recurring class and the dates it puts on the calendar are two separate records, and
        they can come apart. Checked {data.schedules_checked} recurring classes.
        <span className="block mt-1 text-gray-400">
          Usually the calendar is the one that’s right — it’s what gets kept up day to day — and
          the recurring class is just out of date. “The calendar is right” fixes that without
          touching a single class on the calendar. If a difference is meant to be there, hide it
          and it won’t be raised again.
        </span>
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
          Nothing to look at — the calendar and the recurring classes agree.
        </p>
      )}
      <Hidden onChanged={() => setNonce(n => n + 1)} />
    </CollapsibleSection>
  )
}
