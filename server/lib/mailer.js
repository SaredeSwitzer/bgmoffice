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

module.exports = { sendLoginCode, isConfigured };
