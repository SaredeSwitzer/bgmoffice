// Shared "which week am I looking at" memory for every weekly-calendar page (Schedule,
// Billing). One sessionStorage key so picking a week on one page and switching to the
// other keeps the same week in view, instead of each page tracking its own and silently
// snapping back to today. sessionStorage (not localStorage) so it clears with the
// tab/session rather than surprising someone with a stale week days later.
const WEEK_STORAGE_KEY = 'bgm_week_anchor'

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function loadSavedWeekAnchor(startOfWeek) {
  const saved = sessionStorage.getItem(WEEK_STORAGE_KEY)
  if (saved) {
    const [y, m, d] = saved.split('-').map(Number)
    if (y && m && d) return startOfWeek(new Date(y, m - 1, d))
  }
  return startOfWeek(new Date())
}

export function saveWeekAnchor(weekStart) {
  sessionStorage.setItem(WEEK_STORAGE_KEY, ymd(weekStart))
}
