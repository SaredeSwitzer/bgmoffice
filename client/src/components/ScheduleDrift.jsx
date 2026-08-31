import { useEffect, useState } from 'react'
import { api } from '../api/client'
import CollapsibleSection from './CollapsibleSection'

// Where a recurring class and the dated classes on the calendar have come apart.
//
// Deliberately not automatic. A difference is often meant — a substitute for one week,
// a different rate for one date — so this shows what disagrees and lets someone decide,
// with a preview before anything is written. The shape of a difference is the tell:
// ninety-odd classes all saying the same wrong thing is a bug that got missed, one or
// two are almost always somebody's deliberate change.

function Card({ item, onFixed }) {
  const [picked, setPicked]   = useState([])
  const [fixDay, setFixDay]   = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [done, setDone]       = useState(null)

  const nothingPicked = picked.length === 0 && !fixDay

  function toggle(field) {
    setPreview(null)
    setPicked(p => (p.includes(field) ? p.filter(f => f !== field) : [...p, field]))
  }

  async function run(dryRun) {
    setBusy(true); setError('')
    try {
      const res = await api.reconcileSchedule(item.schedule_id, {
        fields: picked, fix_weekday: fixDay, dry_run: dryRun,
      })
      if (dryRun) setPreview(res)
      else { setDone(res); onFixed(item.schedule_id) }
    } catch (e) {
      setError(e.message || 'That did not work.')
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">{item.client_name}</p>
        <p className="text-xs text-green-700 mt-0.5">
          ✓ Updated {done.updated} class{done.updated === 1 ? '' : 'es'}
          {done.removed ? `, moved ${done.removed} onto the right day (${done.regenerated} put back)` : ''}.
        </p>
      </div>
    )
  }

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
        {item.wrong_weekday && (
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={fixDay}
              onChange={e => { setFixDay(e.target.checked); setPreview(null) }}
              className="mt-0.5 accent-blue-600" />
            <span>
              <span className="font-semibold text-red-700">On the wrong day:</span>{' '}
              {item.wrong_weekday.variants.map(v => `${v.count} on ${v.value}`).join(', ')},
              but this class runs {item.wrong_weekday.expected}.
              <span className="block text-gray-400 mt-0.5">
                Ticking this removes those dates and puts the class back on {item.wrong_weekday.expected}.
              </span>
            </span>
          </label>
        )}

        {item.issues.map(iss => (
          <label key={iss.field} className="flex items-start gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={picked.includes(iss.field)}
              onChange={() => toggle(iss.field)} className="mt-0.5 accent-blue-600" />
            <span>
              <span className="font-semibold text-gray-700">{iss.label}:</span>{' '}
              the class says <span className="font-semibold">{iss.schedule_value}</span>, but{' '}
              {iss.variants.map(v => `${v.count} say ${v.value}`).join(' and ')}.
              <span className="block text-gray-400 mt-0.5">
                Ticking this sets all {iss.affected} to {iss.schedule_value}.
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {!preview ? (
          <button onClick={() => run(true)} disabled={busy || nothingPicked}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            {busy ? 'Checking…' : 'Preview the change'}
          </button>
        ) : (
          <>
            <span className="text-xs text-gray-600">
              Will change {preview.updated} class{preview.updated === 1 ? '' : 'es'}
              {preview.removed ? `, and move ${preview.removed} onto the right day` : ''}.
            </span>
            <button onClick={() => run(false)} disabled={busy}
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

export default function ScheduleDrift({ id = 'schedule_drift', defaultOpen = false }) {
  const [data, setData]       = useState(null)
  const [fixed, setFixed]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getScheduleDrift()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) return null
  const outstanding = data.report.filter(r => !fixed.includes(r.schedule_id))
  if (!data.report.length) return null

  return (
    <CollapsibleSection
      id={id} accent="amber" title="⚠ Calendar doesn't match the class"
      count={outstanding.length} defaultOpen={defaultOpen}
    >
      <p className="text-xs text-gray-500 mb-3 px-1 max-w-3xl">
        A recurring class and the dates it puts on the calendar are two separate records, and
        they can come apart — usually because a change to the class was made before the app
        knew to push it down. Checked {data.schedules_checked} recurring classes.
        <span className="block mt-1 text-gray-400">
          Lots of classes all saying the same thing is usually the mistake. One or two on their
          own are usually deliberate — a substitute, a one-off rate — so leave those alone. And
          if the <em>calendar</em> is the one that's right, edit the recurring class instead:
          that now pushes down to future classes on its own.
        </span>
      </p>
      <div className="space-y-2">
        {data.report.map(item => (
          <Card key={item.schedule_id} item={item} onFixed={sid => setFixed(f => [...f, sid])} />
        ))}
      </div>
    </CollapsibleSection>
  )
}
