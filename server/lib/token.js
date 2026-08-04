const jwt = require('jsonwebtoken');

// The one place a session token is minted. Every sign-in path — emailed code, passkey,
// password — ends here, so they are genuinely interchangeable and the rest of the app
// (requireAuth, every route, the Settings UI) never has to know which one was used.
//
// 30d, not 8h: sign-in is now an emailed code or a Touch ID prompt, and an 8-hour token meant
// Sarede was doing that every single day just to open her own office app. The token carries no
// secret beyond identity + role, and any account can be cut off instantly with users.active = 0.
// instructor_id rides along so the scoped endpoints never have to re-look-up which instructor
// this account is. Null for admin/staff; the DB refuses an 'instructor' row without one.
//
// Coerced to a number because instructor_id is BIGINT and node-postgres hands those back as
// strings — so it would otherwise reach the client as "58", and any === comparison against a
// numeric id would quietly be false.
function instructorId(user) {
  return user.instructor_id == null ? null : Number(user.instructor_id);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, initials: user.initials, email: user.email, role: user.role,
      instructor_id: instructorId(user) },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(user) {
  return { id: user.id, name: user.name, initials: user.initials, email: user.email, role: user.role,
           instructor_id: instructorId(user) };
}

module.exports = { signToken, publicUser };
