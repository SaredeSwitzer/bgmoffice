// How to open a text to a client.
//
// A person gets their first name. An organisation is trickier: several clients are filed
// as "Shalom Center - Genya" or "HaMaspik - Charny Schonfeld" — the place, a dash, and the
// person we actually deal with. "Hi Shalom Center - Genya!" is not how anybody talks, and
// it is a human reading it, so the name after the dash wins.
//
// This lived only in the confirmation texts. The weekly reminder had its own rule and
// greeted the same client by their whole filed name, so the two messages addressed one
// person two different ways. One rule now, in one place.
function firstWord(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first ? first[0].toUpperCase() + first.slice(1) : '';
}

function greetingName(client) {
  if (!client) return 'there';
  const contact = firstWord(client.contact_person_name);
  if (contact) return contact;
  // "Place - Person", "Place -- Person": the part after the last dash separator.
  const m = String(client.name || '').match(/\s-{1,2}\s*(.+)$/);
  if (m) return firstWord(m[1]);
  if (client.client_type === 'organization') return client.name || 'there';
  return firstWord(client.name) || 'there';
}

module.exports = { greetingName, firstWord };
