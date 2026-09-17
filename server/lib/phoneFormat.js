// Tidies a phone number the moment it is saved, so the record holds "(917) 555-1234"
// rather than whatever the clipboard delivered.
//
// Why: 121 records were found carrying invisible Unicode direction marks (U+202A/U+202C)
// around the number — iPhone Contacts wraps a copied number in them — plus tabs, doubled
// spaces and every format under the sun. They render fine, so nobody sees the problem,
// but two "identical" numbers then fail to match and the Texts inbox can't tie a reply to
// its person. Cleaned once here at the door instead of chased through the data again.
//
// Anything that isn't a plain US number (an Israeli mobile, a short code, "n/a") is left
// as typed apart from the invisible characters — we tidy, we don't judge.

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿ \t]/g;

function cleanPhone(raw) {
  if (raw === undefined || raw === null) return raw;
  const s = String(raw).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // "(212) 777-5966 x802" — keep the extension, format the number in front of it.
  const m = s.match(/^(.*?)(\s*(?:x|ext\.?|extension)\s*\d+)?$/i);
  const main = m[1].trim();
  const ext = m[2] ? ` x${m[2].replace(/\D/g, '')}` : '';
  const d = main.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  // Only reformat when the whole thing is a US number — a "+" or letters mean it isn't.
  if (ten.length === 10 && /^[\d\s().+-]*$/.test(main) && !main.startsWith('+')) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}${ext}`;
  }
  return s;
}

module.exports = { cleanPhone };
