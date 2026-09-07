const PDFDocument = require('pdfkit');

const APP_URL = process.env.PUBLIC_APP_URL || 'https://bgmoffice.com';

// The client's own copy of what they signed.
//
// A waiver they agreed to and never see again is not much of an agreement — and when a
// question comes up later ("what did I actually sign?"), the answer should be in their own
// inbox rather than something they have to ask for. So this is the full text as it stood
// at the moment of signing, taken from the signature row rather than from settings: the
// wording in Settings can be edited afterwards, and the copy has to be what THEY agreed
// to, not what the current template happens to say.
//
// The signature block records the typed name, the moment, and the IP it came from — the
// same three things that make a typed signature mean anything.
function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

async function buildSignedWaiverPdf(sig) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  let y = 40;
  try {
    const resp = await fetch(`${APP_URL}/logo.jpg`);
    if (!resp.ok) throw new Error('logo fetch failed');
    doc.image(Buffer.from(await resp.arrayBuffer()), left, y, { width: 90 });
    y += 62;
  } catch {
    // A missing logo is not a reason to withhold somebody's signed agreement.
    doc.fontSize(13).font('Helvetica-Bold').text('Bring the Gym to Me, LLC', left, y);
    y += 24;
  }

  doc.fontSize(9).font('Helvetica').fillColor('#666')
     .text('Bring the Gym to Me, LLC', left, y);
  y += 22;

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000')
     .text(sig.org_name ? 'Client Contract for Services' : 'Client Waiver', left, y);
  y += 26;

  doc.fontSize(9).font('Helvetica').fillColor('#444')
     .text(`Signed ${fmtWhen(sig.signed_at)}`, left, y);
  y += 20;

  doc.moveTo(left, y).lineTo(left + width, y).strokeColor('#ddd').stroke();
  y += 16;

  // The agreement itself, exactly as presented.
  doc.fontSize(10).font('Helvetica').fillColor('#000')
     .text(sig.contract_text || '', left, y, { width, align: 'left', lineGap: 2 });

  if (sig.payment_terms_text) {
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text('Payment terms');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(sig.payment_terms_text, { width, lineGap: 2 });
  }

  // The signature block is positioned by hand rather than flowed, so it has to be given
  // room deliberately: writing a line past the bottom margin makes pdfkit start a new page
  // *per line*, which turned a two-page waiver into eight. Measure first, break once.
  const lines = [
    sig.org_name ? `Organization: ${sig.org_name}` : null,
    sig.email ? `Email: ${sig.email}` : null,
    sig.phone ? `Phone: ${sig.phone}` : null,
    `Date: ${fmtWhen(sig.signed_at)}`,
    sig.ip_address ? `Signed from IP ${sig.ip_address}` : null,
  ].filter(Boolean);

  const blockHeight = 45 + lines.length * 12 + 12;
  const bottom = doc.page.height - doc.page.margins.bottom;
  doc.moveDown(1.5);
  if (doc.y + blockHeight > bottom) doc.addPage();

  const blockY = doc.y;
  doc.rect(left, blockY, width, blockHeight).fillAndStroke('#f7f7f7', '#ddd');
  doc.fillColor('#000');

  let by = blockY + 12;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#666')
     .text('SIGNED BY', left + 12, by, { lineBreak: false });
  by += 13;
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000')
     .text(sig.signed_name || '—', left + 12, by, { lineBreak: false });
  by += 20;

  doc.fontSize(9).font('Helvetica').fillColor('#444');
  for (const line of lines) {
    doc.text(line, left + 12, by, { lineBreak: false });
    by += 12;
  }

  doc.end();
  return done;
}

module.exports = { buildSignedWaiverPdf };
