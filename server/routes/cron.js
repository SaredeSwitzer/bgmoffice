const express = require('express');
const { runWeeklySync } = require('../lib/weeklySync');

const router = express.Router();

// Vercel Cron sends a GET with `Authorization: Bearer $CRON_SECRET` — no user is signed in,
// so this does NOT use requireAuth. The secret is the only gate; without it set, the route
// refuses every request rather than running unauthenticated.
router.get('/weekly-sync', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization || '';
  if (!secret || header !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runWeeklySync();
    res.json(result);
  } catch (e) {
    console.error('[cron] weekly-sync failed:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
