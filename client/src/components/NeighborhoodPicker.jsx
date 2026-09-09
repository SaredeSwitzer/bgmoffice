import { useEffect, useState } from 'react'
import { api } from '../api/client'
import SignupOptionPicker from './SignupOptionPicker'
import { normalizeState, stateLabel } from '../utils/places'

// Which neighborhoods somebody can teach in, picked off a list rather than typed.
//
// This is the same tap-to-choose control the class styles use, and it now works for every
// state rather than only New York — a New Jersey instructor used to get an empty text box
// and typed whatever they liked, which is how "New Jersey", "Bergen" and "Saddle River,
// NJ" all ended up filed as neighborhoods.
//
// The list shown is the chosen state's areas, grouped by borough or region. "+ Other"
// files a genuinely new name into that state and area, so the next person to open any of
// these forms is offered it too.
//
// One component behind every place that asks — the public sign-up, an instructor's own
// profile, and both staff screens — so the four can't drift apart again.
export default function NeighborhoodPicker({ value, onChange, state }) {
  const [all, setAll] = useState([])
  const [areasByState, setAreasByState] = useState({})

  useEffect(() => {
    api.getSignupNeighborhoods()
      .then(d => { setAll(d.neighborhoods || []); setAreasByState(d.areas_by_state || {}) })
      .catch(() => {})
  }, [])

  // Nearly everyone is in New York, so an unanswered state shows New York rather than
  // nothing at all — with a line saying so, since the fix is one field away.
  const chosen = normalizeState(state)
  const st = chosen || 'NY'
  const options = all.filter(n => (normalizeState(n.state) || 'NY') === st)
  const regions = areasByState[st] || ['Other']

  async function handleAdd(name, region) {
    const row = await api.addSignupNeighborhood(name, region, st)
    setAll(prev => prev.some(n => n.id === row.id) ? prev : [...prev, row])
    return row
  }

  return (
    <>
      <SignupOptionPicker
        options={options}
        regions={regions}
        value={value}
        onChange={onChange}
        onAdd={handleAdd}
        addLabel="neighborhood"
      />
      {!chosen && (
        <p className="text-[11px] text-gray-400 mt-1">
          Showing New York areas — set the state above for somewhere else.
        </p>
      )}
      {chosen && chosen !== 'NY' && options.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1">
          No {stateLabel(chosen)} areas on the list yet — use “+ Other” to add the first one.
        </p>
      )}
    </>
  )
}
