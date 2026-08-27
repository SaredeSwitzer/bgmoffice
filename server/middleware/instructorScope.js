const jwt = require('jsonwebtoken');

// Deny-by-default for instructor accounts.
//
// Why this exists as one central guard rather than a check in each route: every route file
// in this app does a blanket `router.use(requireAuth)`, and the only privilege levels are
// requireAuth and requireAdmin. So the moment an instructor account exists, it can read AND
// write every client, pay rate, SSN and invoice. Auditing 17 route files and remembering to
// re-audit each new one is the kind of thing that silently fails open.
//
// This inverts it: an instructor may reach ONLY what is listed below. Anything added to the
// app later is closed to instructors until someone deliberately opens it.
//
// It verifies the JWT itself instead of reading req.user, because it is mounted at the /api
// level — ahead of the per-router requireAuth that would populate req.user. It never
// *authenticates*: a missing or bad token just falls through to requireAuth, which 401s.

const INSTRUCTOR_ALLOWLIST = [
  { method: 'GET',  path: /^\/auth\/me$/ },
  { method: 'POST', path: /^\/auth\/logout$/ },
  { method: 'GET',  path: /^\/schedule\/my-sessions$/ },
  { method: 'GET',  path: /^\/schedule\/my-venmo-target$/ },
  { method: 'GET',  path: /^\/payout-requests\/status$/ },
  { method: 'POST', path: /^\/payout-requests$/ },
  // Own profile only — routes below still check req.user.instructor_id === :id themselves;
  // this just opens the path, it doesn't grant access to every instructor's record.
  { method: 'GET',    path: /^\/instructors\/\d+$/ },
  { method: 'PUT',    path: /^\/instructors\/\d+$/ },
  { method: 'POST',   path: /^\/instructors\/\d+\/photo$/ },
  { method: 'GET',    path: /^\/instructors\/\d+\/documents$/ },
  { method: 'POST',   path: /^\/instructors\/\d+\/documents$/ },
  { method: 'DELETE', path: /^\/instructors\/\d+\/documents\/\d+$/ },
  { method: 'GET',    path: /^\/instructors\/\d+\/availability$/ },
  { method: 'POST',   path: /^\/instructors\/\d+\/availability$/ },
  { method: 'PUT',    path: /^\/instructors\/\d+\/availability\/\d+$/ },
  { method: 'DELETE', path: /^\/instructors\/\d+\/availability\/\d+$/ },
  { method: 'GET',    path: /^\/instructors\/\d+\/availability-check$/ },
  { method: 'POST',   path: /^\/instructors\/\d+\/availability-check$/ },
  // Shared option lists behind the neighborhood/class-style pickers on an instructor's
  // own profile. These are already fully public (server/routes/instructorSignup.js
  // registers them ahead of requireAuth, for the no-login /join page), so listing them
  // grants an instructor account nothing it couldn't get while signed out — without it
  // the pickers render empty for the very people meant to use them.
  { method: 'GET',    path: /^\/instructor-signup\/neighborhoods$/ },
  { method: 'POST',   path: /^\/instructor-signup\/neighborhoods$/ },
  { method: 'GET',    path: /^\/instructor-signup\/class-styles$/ },
  { method: 'POST',   path: /^\/instructor-signup\/class-styles$/ },
];

function denyInstructor(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  let user;
  try {
    user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return next(); // invalid/expired — requireAuth is the one that rejects it
  }

  if (user.role !== 'instructor') return next();

  const allowed = INSTRUCTOR_ALLOWLIST.some(
    (rule) => rule.method === req.method && rule.path.test(req.path)
  );
  if (allowed) return next();

  return res.status(403).json({ error: 'Not available for instructor accounts' });
}

module.exports = { denyInstructor, INSTRUCTOR_ALLOWLIST };
