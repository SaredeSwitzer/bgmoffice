const pool = require('../db/pg');

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const { rows: [last] } = await pool.query(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY id DESC LIMIT 1",
    [`INV-${year}-%`]
  );
  if (!last) return `INV-${year}-001`;
  const seq = parseInt(last.invoice_number.split('-')[2], 10) + 1;
  return `INV-${year}-${String(seq).padStart(3, '0')}`;
}

function calcTotals(lineItems, taxRate) {
  const subtotal   = lineItems.reduce((s, li) => s + Number(li.unit_price || 0), 0);
  const tax_amount = subtotal * (Number(taxRate) / 100);
  return { subtotal, tax_amount, total: subtotal + tax_amount };
}

module.exports = { nextInvoiceNumber, calcTotals };
