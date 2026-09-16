// The instructor's first name, for messages the CLIENT reads.
//
// A client knows their instructor as "Sharon", not "Sharon Moreno" — the surname makes a
// warm message read like a database record. Instructor-facing messages are unaffected;
// this is only about how we talk to clients about the person teaching them.
function instructorFirstName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const first = s.split(' ')[0];
  // A single letter is an initial, not a name. One instructor is on file as
  // "A b waliuddin chowdhury"; "your class with A" reads as a bug, so keep the whole
  // thing rather than produce something that looks broken.
  if (first.length < 2) return s;
  return first[0].toUpperCase() + first.slice(1);
}

module.exports = { instructorFirstName };
