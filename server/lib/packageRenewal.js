const pool = require('../db/pg');

// "One class left" — the moment to ask whether they want to carry on.
//
// A package runs out quietly. The classes keep happening, the last one goes by, and the
// question of whether there's another package only comes up when somebody notices the
// count — which is how Etty reached her twelfth class with nobody having asked. One class
// left is the right moment: there's still a class on the books, so it's a question rather
// than an apology.
//
// Nothing sends on its own. The nightly run raises a reminder; the text is written for her
// and she reads it and presses send, same as every other message this app writes. A text
// about money that the client didn't expect, sent by a machine at 3am, is exactly the kind
// of thing that costs you a client.

const LOW_AT = 1;   // classes remaining that triggers the nudge

function monthName(ym) {
  return ['January','February','March','April','May','June',
          'July','August','September','October','November','December'][Number(ym) - 1];
}

// "Jul 8, 15, 22 and 29; Aug 5 and 12" — a dozen dates written the way a person would say
// them, because twelve full dates is a wall of text nobody reads on a phone.
function classDatesPhrase(dates) {
  const clean = [...new Set(dates.filter(Boolean).map(d => String(d).slice(0, 10)))].sort();
  if (!clean.length) return '';
  const short = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = [];
  for (const d of clean) {
    const [, m, day] = d.split('-');
    const label = short[Number(m) - 1];
    const last = months[months.length - 1];
    if (last && last.label === label) last.days.push(String(Number(day)));
    else months.push({ label, days: [String(Number(day))] });
  }
  return months
    .map(({ label, days }) => `${label} ${joinWords(days)}`)
    .join('; ');
}

function joinWords(parts) {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// Clients are organisations as often as people, and "Hi HaMaspik - Charny Schonfeld" is
// nobody's name. Same rule the confirmation texts use.
// `client_name` is what loadPackage's join calls it — reading `.name` here quietly found
// nothing on the package row and greeted a real client as "there".
function greetingName(client) {
  const name = String(client?.contact_person_name || client?.client_name || client?.name || '').trim();
  const first = name.split(/\s+/)[0];
  return first && first.length > 1 ? first : 'there';
}

// Everything the message needs, read fresh — a package that was topped up an hour ago
// shouldn't produce a text saying it's nearly finished.
async function loadPackage(id) {
  const { rows: [pkg] } = await pool.query(
    `SELECT cp.*, c.name AS client_name, c.phone, c.contact_person_name
       FROM client_packages cp
       JOIN clients c ON c.id = cp.client_id
      WHERE cp.id = $1`,
    [id]
  );
  if (!pkg) return null;
  const { rows: sessions } = await pool.query(
    'SELECT session_date FROM package_sessions WHERE package_id = $1 ORDER BY session_date ASC',
    [id]
  );
  return { ...pkg, sessions: sessions.map(s => s.session_date) };
}

function classesLeft(pkg) {
  return Number(pkg.total_classes || 0) - Number(pkg.classes_used || 0);
}

function buildRenewalText(pkg) {
  const left = classesLeft(pkg);
  const dates = classDatesPhrase(pkg.sessions);
  const countWord = left === 1 ? 'one class left' : `${left} classes left`;
  return [
    `Hi ${greetingName(pkg)}! This is Bring the Gym to Me.`,
    `You have ${countWord} on your ${pkg.total_classes}-class package.`,
    dates ? `The classes so far: ${dates}.` : '',
    `Would you like to carry on with another package after that? Just reply here and we'll set it up.`,
  ].filter(Boolean).join(' ');
}

// Active packages down to their last class that nobody has been told about yet. The
// `renewal_nudge_at` stamp is what stops it asking again every night for a package that
// sits at one class for a fortnight.
async function packagesNeedingNudge() {
  const { rows } = await pool.query(
    `SELECT cp.id, cp.client_id, cp.total_classes, cp.classes_used, c.name AS client_name
       FROM client_packages cp
       JOIN clients c ON c.id = cp.client_id
      WHERE cp.status = 'active'
        AND cp.renewal_nudge_at IS NULL
        AND (cp.total_classes - cp.classes_used) <= $1
        AND (cp.total_classes - cp.classes_used) > 0
      ORDER BY c.name`,
    [LOW_AT]
  );
  return rows;
}

module.exports = {
  LOW_AT, classDatesPhrase, greetingName, loadPackage, classesLeft,
  buildRenewalText, packagesNeedingNudge,
};
