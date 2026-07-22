// Posts a message to the "BGM IT Crew" Telegram group — the channel Sarede/Kip/Yidy already use
// for everything. Best-effort: a notify failure should never break the request that triggered it.
//
// Needs two env vars, in server/.env locally and in Vercel for production:
//
//   CREW_TELEGRAM_BOT_TOKEN=...   (same bot as ~/Git/dash/mcp/telegram-mcp)
//   CREW_TELEGRAM_CHAT_ID=-5371255324

function isConfigured() {
  return Boolean(process.env.CREW_TELEGRAM_BOT_TOKEN && process.env.CREW_TELEGRAM_CHAT_ID);
}

async function notifyCrew(text) {
  if (!isConfigured()) {
    console.log(`[dev] crew notify: ${text}`);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.CREW_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.CREW_TELEGRAM_CHAT_ID, text }),
    });
    if (!res.ok) {
      console.error(`[notifyCrew] telegram rejected (${res.status}): ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.error('[notifyCrew] error:', err.message);
  }
}

module.exports = { notifyCrew, isConfigured };
