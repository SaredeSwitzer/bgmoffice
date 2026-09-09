// Reading a rate somebody typed on a profile — a client's rate per class, or an
// instructor's pay rate. Both are free text and both are used as one.
//
// Of 101 instructors, 24 hold a clean number, 74 hold nothing, and a handful hold a
// sentence: "$200 per day at Beth Shalom", "$65 usually but gave him $80 for extra travel
// time". Client rates are the same: "$95", but also "$35 per child per class min 4 per
// class to run". Copying that straight into a money box put "$50" into a number input
// (which shows blank), pasted prose into a payroll figure, and — worst — wiped the figure
// to empty for everyone with no rate at all. A blank pay is how somebody ends up unpaid.
//
// So read it, don't trust it: only a bare number fills the amount. Anything else is
// shown to the person as a note, and the box is left alone.
export function readRate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { amount: null, note: null }
  const m = /^\$?\s*([0-9]+(?:\.[0-9]+)?)$/.exec(s)
  if (m) return { amount: m[1], note: null }
  return { amount: null, note: s }
}
