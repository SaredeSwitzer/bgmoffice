// One address, on one line, for a text message.
//
// An instructor being told where to turn up needs the street and enough around it to find
// the place — a neighborhood on its own is not an address, and "Brooklyn" alone has sent
// people to the wrong side of the borough. Built from whichever parts exist, because
// plenty of records hold a street and a zip and nothing in between.
//
// A class can have its own address (a client with several locations picks one per class),
// so the caller decides what to pass; this only formats.
function addressLine(a) {
  if (!a) return '';
  const street = String(a.street || '').trim().replace(/\s+/g, ' ');
  const hood = String(a.neighborhood || '').trim();
  const city = String(a.city || '').trim();
  const zip = String(a.zip || '').trim();

  // Without a street there is nowhere to go, and "Williamsburg, Brooklyn" in a reminder
  // reads as an address while being useless. Say nothing rather than something misleading.
  if (!street) return '';

  const tail = [];
  // The neighborhood earns its place only when it is not just repeating the city.
  if (hood && hood.toLowerCase() !== city.toLowerCase()) tail.push(hood);
  if (city) tail.push(city);

  const place = tail.join(', ');
  return [street, place].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
}

module.exports = { addressLine };
