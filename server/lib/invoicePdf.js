const PDFDocument = require('pdfkit');

const APP_URL = process.env.PUBLIC_APP_URL || 'https://bgmoffice.com';

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Mirrors the client-side jsPDF layout in InvoiceDetailPage.jsx's downloadPDF() closely
// enough to look like the same document, built server-side (pdfkit) so it can be
// attached to the send email — a browser-only jsPDF instance has no way to produce
// bytes on the server. `notes` is expected pre-stripped of @mentions by the caller
// (stripMentionsForPublic), same as the public invoice page.
async function buildInvoicePdf(invoice) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  let logoBottom = 40;
  try {
    const logoResp = await fetch(`${APP_URL}/logo.jpg`);
    if (logoResp.ok) {
      const logoBuf = Buffer.from(await logoResp.arrayBuffer());
      doc.image(logoBuf, left, 30, { width: 100 });
      logoBottom = 30 + 50;
    } else {
      throw new Error('logo fetch failed');
    }
  } catch {
    doc.fontSize(14).font('Helvetica-Bold').text('Bring the Gym to Me, LLC', left, 40);
    logoBottom = 40 + 20;
  }

  doc.fontSize(8).font('Helvetica').fillColor('#777')
    .text('Bring the Gym to Me, LLC', left, logoBottom)
    .text('346 New York Ave #5A, Brooklyn, NY 11213', left, logoBottom + 11);
  doc.fillColor('#000');

  doc.fontSize(18).font('Helvetica-Bold').text('INVOICE', left, 40, { width: pageW, align: 'right' });
  doc.fontSize(10).font('Helvetica').fillColor('#555')
    .text(invoice.invoice_number, left, 62, { width: pageW, align: 'right' });
  doc.fillColor('#000');

  const dividerY = logoBottom + 24;
  doc.moveTo(left, dividerY).lineTo(right, dividerY).strokeColor('#ddd').stroke();

  const billY = dividerY + 16;
  doc.fontSize(9).fillColor('#777').text('BILL TO', left, billY);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text(invoice.client_name || '—', left, billY + 12);
  doc.font('Helvetica').fontSize(9);

  doc.fillColor('#777').text('INVOICE DATE', right - 200, billY, { width: 130 });
  doc.fillColor('#000').font('Helvetica-Bold').text(fmtDate(invoice.invoice_date), right - 70, billY, { width: 70, align: 'right' });
  doc.font('Helvetica').fillColor('#777').text('DUE DATE', right - 200, billY + 14, { width: 130 });
  doc.fillColor('#000').font('Helvetica-Bold').text(fmtDate(invoice.due_date), right - 70, billY + 14, { width: 70, align: 'right' });
  doc.font('Helvetica');

  // Line items table
  let y = billY + 44;
  const col1 = left, col2 = right - 190, col3 = right - 80;
  doc.rect(left, y, pageW, 20).fill('#1e1e1e');
  doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
    .text('Description', col1 + 6, y + 6)
    .text('Class Date', col2, y + 6)
    .text('Price', col3, y + 6, { width: right - col3 - 6, align: 'right' });
  doc.fillColor('#000').font('Helvetica');
  y += 20;

  for (const li of invoice.line_items) {
    const rowH = 20;
    doc.fontSize(9)
      .text(li.description || '', col1 + 6, y + 6, { width: col2 - col1 - 12 })
      .text(li.class_date ? fmtDate(li.class_date) : '—', col2, y + 6, { width: col3 - col2 })
      .text(fmtMoney(li.unit_price), col3, y + 6, { width: right - col3 - 6, align: 'right' });
    doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor('#eee').stroke();
    y += rowH;
  }

  y += 14;
  const totalsColX = right - 150;
  doc.fontSize(10).fillColor('#666')
    .text('Subtotal:', totalsColX, y)
    .text(fmtMoney(invoice.subtotal), totalsColX, y, { width: right - totalsColX, align: 'right' });
  y += 16;
  doc.text(`Tax (${invoice.tax_rate}%):`, totalsColX, y)
    .text(fmtMoney(invoice.tax_amount), totalsColX, y, { width: right - totalsColX, align: 'right' });
  y += 18;
  doc.fontSize(12).fillColor('#000').font('Helvetica-Bold')
    .text('Total Due:', totalsColX, y)
    .text(fmtMoney(invoice.total), totalsColX, y, { width: right - totalsColX, align: 'right' });
  doc.font('Helvetica');
  y += 24;

  if (invoice.notes) {
    doc.fontSize(9).fillColor('#777').text('Notes:', left, y);
    y += 12;
    doc.fontSize(9).fillColor('#444').text(invoice.notes, left, y, { width: pageW / 2 });
    y += doc.heightOfString(invoice.notes, { width: pageW / 2 }) + 14;
  } else {
    y += 8;
  }

  doc.moveTo(left, y).lineTo(right, y).strokeColor('#ddd').stroke();
  y += 12;
  doc.fontSize(9).fillColor('#666').text('PAYMENT OPTIONS', left, y);
  y += 12;
  doc.fontSize(8.5).fillColor('#444')
    .text(`Credit card: Pay online at ${APP_URL}/pay/${invoice.public_token}`, left, y);
  y += 10;
  doc.text('Check: Make payable to Bring the Gym to Me, LLC', left, y);
  y += 10;
  doc.text('        Mail to: 346 New York Ave #5A, Brooklyn, NY 11213', left, y);
  y += 10;
  doc.fillColor('#777').text(`(include invoice ${invoice.invoice_number} in the memo)`, left, y);

  doc.end();
  return done;
}

module.exports = { buildInvoicePdf };
