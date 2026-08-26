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

// The three named office staff (Sarede, Claire, Maria) plus Sarede's generic Admin
// login (she signs in as either depending on device) — deliberately narrower than
// requireStaff/requireAdmin, and NOT auto-extended by adding someone with role='staff'
// or role='admin' later. Used for admin_notes, which must stay off-limits to anyone else.
const OWNER_EMAILS = ['admin@bgmoffice.com', 'sarede@bgmoffice.com', 'claire@bgmoffice.com', 'maria@bgmoffice.com'];

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
