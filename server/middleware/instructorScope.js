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
