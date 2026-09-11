const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Staff and admin accounts both get full day-to-day access (schedule, billing, etc).
// Only Settings and other truly admin-literal routes should use requireAdmin instead.
function requireStaff(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'staff') {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
}

// The named office staff (Sarede, Claire, Maria, and Erica from 2026-09-10) plus Sarede's
// generic Admin login, which she signs into on some devices. Deliberately a list of people
// rather than a role test: it must NOT widen on its own the next time somebody is given
// role='staff' or role='admin'. Used for admin_notes, which stay off-limits to everyone
// else — including every instructor login.
//
// Adding a colleague here is a decision, not a formality. Erica was added because Sarede
// said she should see everything Claire and Maria see.
const OWNER_EMAILS = [
  'admin@bgmoffice.com',
  'sarede@bgmoffice.com',
  'claire@bgmoffice.com',
  'maria@bgmoffice.com',
  'erica@bgmoffice.com',
];

function requireOwnerAccess(req, res, next) {
  if (!OWNER_EMAILS.includes(req.user?.email)) {
    return res.status(403).json({ error: 'Not available on this account' });
  }
  next();
}

// Narrower still than requireOwnerAccess — Sarede's own login, or the generic Admin
// login she also signs into (same person, different device/habit). NOT Claire or Maria.
// Used for the sales-leads tracker, which is deliberately hers alone.
const SAREDE_EMAILS = ['admin@bgmoffice.com', 'sarede@bgmoffice.com'];

function requireSaredeOnly(req, res, next) {
  if (!SAREDE_EMAILS.includes(req.user?.email)) {
    return res.status(403).json({ error: 'Not available on this account' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireStaff, requireOwnerAccess, requireSaredeOnly };
