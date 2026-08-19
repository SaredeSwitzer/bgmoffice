// Sends the 6-digit sign-in code.
//
// Uses Resend's HTTP API directly (no npm package — one less dependency to break).
// Needs two env vars, in server/.env locally and in Vercel for production:
//
//   RESEND_API_KEY=re_...
//   MAIL_FROM="BGM Office <login@bgmoffice.com>"   ← the domain must be verified in Resend
//
// If RESEND_API_KEY is missing we do NOT send and we do NOT pretend we did: the caller
// turns that into a visible error, so a misconfigured deploy can't silently lock everyone
// out. In local dev the code is printed to the console instead so you can still log in.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendLoginCode(to, code) {
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured (RESEND_API_KEY / MAIL_FROM missing)');
    }
    console.log(`\n[dev] sign-in code for ${to}: ${code}\n`);
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [to],
      subject: `${code} is your BGM Office sign-in code`,
      text: `Your BGM Office sign-in code is ${code}\n\n`
          + `It expires in 10 minutes and can only be used once.\n\n`
          + `If you didn't try to sign in, you can ignore this email — `
          + `nobody can get in without the code.`,
      html: `
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:16px;color:#111827;margin:0 0 24px">BGM Office</h1>
          <p style="font-size:14px;color:#374151;margin:0 0 16px">Here's your sign-in code:</p>
          <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#111827;margin:0 0 16px">${code}</p>
          <p style="font-size:13px;color:#6b7280;margin:0 0 24px">
            It expires in 10 minutes and can only be used once.
          </p>
          <p style="font-size:12px;color:#9ca3af;margin:0">
            If you didn't try to sign in, you can ignore this email — nobody can get in without the code.
          </p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend rejected the email (${res.status}): ${body.slice(0, 200)}`);
  }
}

// Generic transactional send (instructor confirmations, etc.). Same Resend path as the
// login code. Throws in production if email isn't configured so a caller can surface it;
// in dev it logs instead of silently dropping.
async function sendMail({ to, subject, text, html, replyTo, from, cc }) {
  if (!to) throw new Error('No recipient email');
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured (RESEND_API_KEY / MAIL_FROM missing)');
    }
    console.log(`\n[dev] email to ${to}: ${subject}\n${text || ''}\n`);
    return;
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || process.env.MAIL_FROM,
      to: [to],
      subject,
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend rejected the email (${res.status}): ${body.slice(0, 200)}`);
  }
}

const BILLING_FROM  = 'Bring the Gym To Me <billing@bgmoffice.com>';
const BILLING_REPLY = 'sarede@bringthegymtome.com';

// Receipt for a successful card charge — weekly recurring classes or a one-off invoice
// payment. Best-effort: a receipt failing to send should never undo or block the charge
// itself, so callers should catch/log rather than let this throw stop anything.
async function sendChargeReceipt({ to, clientName, amount, description }) {
  const money = `$${Number(amount).toFixed(2)}`;
  await sendMail({
    to,
    from: BILLING_FROM,
    replyTo: BILLING_REPLY,
    subject: `Receipt: ${money} charged — BGM Office`,
    text: `Hi ${clientName},\n\nThis confirms a charge of ${money} for ${description}.\n\n`
        + `Questions about this charge? Just reply to this email.\n\n— BGM Office`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
        <h1 style="font-size:16px;color:#111827;margin:0 0 24px">BGM Office</h1>
        <p style="font-size:14px;color:#374151;margin:0 0 16px">Hi ${clientName},</p>
        <p style="font-size:14px;color:#374151;margin:0 0 16px">This confirms a charge of:</p>
        <p style="font-size:28px;font-weight:700;color:#111827;margin:0 0 8px">${money}</p>
        <p style="font-size:13px;color:#6b7280;margin:0 0 24px">${description}</p>
        <p style="font-size:12px;color:#9ca3af;margin:0">Questions about this charge? Just reply to this email.</p>
      </div>`,
  });
}

const OWNER_NOTIFY_EMAIL = 'sarede@bringthegymtome.com';

// Owner-facing heads-up when a client pays an invoice — same event the "BGM IT Crew" Telegram
// group gets, just also by email. Best-effort like sendChargeReceipt: never let this block or
// undo the payment itself.
async function sendInvoicePaidAlert({ clientName, invoiceNumber, amount }) {
  const money = `$${Number(amount).toFixed(2)}`;
  await sendMail({
    to: OWNER_NOTIFY_EMAIL,
    from: BILLING_FROM,
    subject: `Invoice ${invoiceNumber} paid — ${money} from ${clientName}`,
    text: `${clientName} just paid invoice ${invoiceNumber} (${money}) by card.\n\n— BGM Office`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:420px;margin:0 auto;padding:32px 24px">
        <h1 style="font-size:16px;color:#111827;margin:0 0 24px">BGM Office</h1>
        <p style="font-size:14px;color:#374151;margin:0 0 8px"><strong>${clientName}</strong> just paid invoice <strong>${invoiceNumber}</strong>.</p>
        <p style="font-size:28px;font-weight:700;color:#111827;margin:0">${money}</p>
      </div>`,
  });
}

module.exports = { sendLoginCode, sendMail, sendChargeReceipt, sendInvoicePaidAlert, isConfigured };
