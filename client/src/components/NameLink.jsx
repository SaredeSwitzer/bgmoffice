import { Link } from 'react-router-dom'

// Client/instructor names shown anywhere in the app link to their profile page when an
// id is available; falls back to plain text when it isn't (e.g. a recruiting entry not
// yet linked to a real client record) — same graceful-fallback pattern RecruitingPage.jsx
// already used ad hoc in a dozen places, just centralized so every other page matches it.
//
// stopPropagation defaults true since most call sites nest this inside a clickable table
// row/card that navigates somewhere else on click — without it, clicking the name would
// fire both navigations.

export function ClientLink({ id, name, className = 'hover:underline', stopPropagation = true, children }) {
  if (!id) return <>{children || name}</>
  return (
    <Link to={`/clients/${id}`} className={className}
      onClick={stopPropagation ? (e => e.stopPropagation()) : undefined}>
      {children || name}
    </Link>
  )
}

export function InstructorLink({ id, name, className = 'hover:underline', stopPropagation = true, children }) {
  if (!id) return <>{children || name}</>
  return (
    <Link to={`/instructors/${id}`} className={className}
      onClick={stopPropagation ? (e => e.stopPropagation()) : undefined}>
      {children || name}
    </Link>
  )
}
