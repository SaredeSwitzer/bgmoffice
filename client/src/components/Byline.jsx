import { noteTime } from '../utils/dates'
import { authorLabel } from '../utils/author'

// Who wrote it and when.
//
// Every note in the app already carried this line; the thing someone typed *first* — the
// line on the Waiting On sheet, the case a shift opened, the follow-up's opening note —
// did not, so a week later nobody could tell whose handwriting it was. This is that same
// stamp, in one place, so it reads the same everywhere it appears.
//
// It renders nothing when there's nothing to say, which is what old rows written before
// the app recorded an author look like.
export default function Byline({
  author, at, prefix = '', className = 'text-[10px] text-gray-400',
}) {
  const who  = authorLabel(author)
  const when = noteTime(at)
  if (!who && !when) return null
  return (
    <p className={className}>
      {prefix && `${prefix} `}
      {who && <span className="font-semibold text-gray-500">{who}</span>}
      {who && when && ' · '}
      {when}
    </p>
  )
}
