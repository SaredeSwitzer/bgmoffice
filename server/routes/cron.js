const express = require('express');
const { runDailySync, syncDateRange } = require('../lib/dailySync');

const router = express.Router();

// Vercel Cron sends a GET with `Authorization: Bearer $CRON_SECRET` — no user is signed in,
// so this does NOT use requireAuth. The secret is the only gate; without it set, the route
// refuses every request rather than running unauthenticated.
//
// Optional ?start=YYYY-MM-DD&end=YYYY-MM-DD reprocesses an explicit range instead of
// "yesterday" — safe to rerun (see dailySync.js), used to catch up after a missed run or
// backfill a gap. Same secret required either way.
router.get('/daily-sync', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { start, end } = req.query;
    const result = (start && end) ? await syncDateRange(start, end) : await runDailySync();
    res.json(result);
  } catch (e) {
    console.error('[cron] daily-sync failed:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
