import TimeInput from './TimeInput'
import { addMinutesToTime, minutesBetween } from '../utils/time'

// End Time + Duration for a class, kept in sync: typing an end time computes the
// duration from the class's start time, so staff don't have to do the math. Duration
// itself stays directly editable too (5-minute steps) for when there's no clean end
// time — e.g. duration is known but the exact clock time isn't being tracked.
// Renders as two sibling elements (not wrapped), so it drops into the caller's own grid.
export default function DurationInput({ startTime, durationMinutes, onDurationChange, py = 'py-2' }) {
  const endTimeValue = startTime ? addMinutesToTime(startTime, durationMinutes || 60) : ''
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">End Time</label>
        <TimeInput
          value={endTimeValue}
          onChange={v => { if (startTime && v) onDurationChange(minutesBetween(startTime, v)) }}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Duration (min)</label>
        <input
          type="number" step="5" min="5"
          value={durationMinutes}
          onChange={e => onDurationChange(Number(e.target.value) || 60)}
          className={`w-full border border-gray-300 rounded-lg px-3 ${py} text-sm`}
        />
      </div>
    </>
  )
}
