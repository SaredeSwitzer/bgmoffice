const pool = require('../db/pg');

// Whether we are allowed to text this client at all.
//
// Some clients have asked us not to be texted, and one of them — Connections — gets
// genuinely annoyed when it happens. Before this the only setting was a weekly-reminder
// opt-out, so a client who wanted no texts still got class confirmations and change
// alerts; somebody had resorted to renaming the client "… - DO NOT TEXT" to warn staff
// off, which is as clear a sign as you get that the setting people needed did not exist.
//
// Checked on the server rather than only hiding the button, because the button is not the
// only way a text goes out — a class change fires one on its own.
async function clientTextingBlocked(clientId) {
  if (!clientId) return null;
  const { rows: [c] } = await pool.query(
    'SELECT name, no_texting FROM clients WHERE id = $1', [clientId]);
  if (!c?.no_texting) return null;
  return {
    blocked: true,
    client_name: c.name,
    // Said the way she would say it, and it names the way out rather than being a dead end.
    reason: `${c.name} has asked not to be texted. You can turn that off on their profile if it has changed.`,
  };
}

module.exports = { clientTextingBlocked };
