require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.set('trust proxy', 1);

const rawOrigins = process.env.ALLOWED_ORIGIN || 'https://bgmoffice.netlify.app';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Stripe webhook — raw body, registered BEFORE express.json()
app.post('/api/invoices/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const pool = require('./db/pg');
  const webhookSecretRow = await pool.query("SELECT value FROM app_settings WHERE key='stripe_webhook_secret'");
  const webhookSecret = webhookSecretRow.rows[0]?.value || process.env.STRIPE_WEBHOOK_SECRET;
  const secretKeyRow  = await pool.query("SELECT value FROM app_settings WHERE key='stripe_secret_key'");
  const secretKey     = secretKeyRow.rows[0]?.value || process.env.STRIPE_SECRET_KEY;

  if (!secretKey) return res.status(503).json({ error: 'Stripe not configured' });
  const stripe = require('stripe')(secretKey);

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
      console.warn('[stripe webhook] No webhook secret — skipping signature verification');
    }
  } catch (err) {
    console.error('[stripe webhook] signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const invoiceId = pi.metadata?.invoice_id;
    if (invoiceId) {
      await pool.query(
        "UPDATE invoices SET status='paid', paid_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS'), updated_at=to_char(NOW(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$1 AND status != 'paid'",
        [invoiceId]
      );
      console.log(`[stripe webhook] Invoice ${invoiceId} marked paid`);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// Real health check, replacing a `res.json({status:'ok'})` stub that would have reported
// "ok" through every outage this app has actually had — the Express process was never the
// thing that broke. What broke was: the DB URL missing, the Stripe key unreachable, no
// webhook registered, email unconfigured. So check *those*.
//
// Public on purpose (an uptime monitor has to reach it without a login). It returns only
// booleans — never a secret value.
//
// 200 = everything a customer needs is working.
// 503 = something is broken that will cost her money or lock her out. Page someone.
app.get('/api/health', async (req, res) => {
  const pool = require('./db/pg');
  const checks = {};

  // The database is the app. If this fails, nothing else matters.
  try {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE active = 1');
    checks.database = true;
    checks.users_present = rows[0].n > 0;
  } catch {
    checks.database = false;
    checks.users_present = false;
  }

  // Config that has silently gone missing before. Each of these was a real outage.
  let settings = {};
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM app_settings WHERE key IN ('stripe_secret_key','stripe_publishable_key','stripe_webhook_secret')"
    );
    settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  } catch { /* database check above already failed */ }

  checks.jwt_secret       = Boolean(process.env.JWT_SECRET);
  checks.allowed_origin   = Boolean(process.env.ALLOWED_ORIGIN);      // empty here broke browser login
  checks.email_sending    = Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM); // no email = nobody can log in
  checks.stripe_keys      = Boolean(settings.stripe_secret_key && settings.stripe_publishable_key);
  checks.stripe_webhook   = Boolean(settings.stripe_webhook_secret); // missing = payments never marked paid

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const healthy = failed.length === 0;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    failed,
    checks,
    checked_at: new Date().toISOString(),
  });
});

// Public: Stripe publishable key
app.get('/api/settings/stripe-public', async (req, res) => {
  const pool = require('./db/pg');
  const row = (await pool.query("SELECT value FROM app_settings WHERE key='stripe_publishable_key'")).rows[0];
  res.json({ publishable_key: row?.value || process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

// Supabase Storage proxy for uploads (serves files from Supabase Storage)
app.use('/uploads', (req, res) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const filename = req.path.replace(/^\//, '');
  if (!SUPABASE_URL || !filename) return res.status(404).send('Not found');
  res.redirect(`${SUPABASE_URL}/storage/v1/object/public/bgm-uploads/${filename}`);
});

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/auth/passkeys', require('./routes/passkeys'));

app.use('/api/clients',      require('./routes/clients'));
app.use('/api/instructors',  require('./routes/instructors'));
app.use('/api/cases',        require('./routes/cases'));
app.use('/api/action-items', require('./routes/actionItems'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/reminders',    require('./routes/reminders'));
app.use('/api/reference',    require('./routes/reference'));
app.use('/api/recruiting',   require('./routes/recruitingIntake'));
app.use('/api/recruiting',   require('./routes/recruiting'));
app.use('/api/invoices',     require('./routes/invoices'));
app.use('/api/tasks',        require('./routes/tasks'));
app.use('/api/packages',     require('./routes/packages'));

// Action type lookups (any authenticated user)
const { requireAuth } = require('./middleware/auth');
const pool = require('./db/pg');

app.get('/api/action-types', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM action_types ORDER BY order_index ASC');
  res.json(rows);
});
app.post('/api/action-types', requireAuth, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const maxRow = (await pool.query('SELECT MAX(order_index) AS m FROM action_types')).rows[0];
  const maxOrder = maxRow.m || 0;
  try {
    const { rows } = await pool.query(
      'INSERT INTO action_types (name, color, order_index) VALUES ($1, $2, $3) RETURNING *',
      [name.toUpperCase().trim(), color || 'gray', maxOrder + 1]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(400).json({ error: 'Action type name must be unique' });
  }
});
app.put('/api/action-types/:id', requireAuth, async (req, res) => {
  const { name, color } = req.body;
  const existing = (await pool.query('SELECT * FROM action_types WHERE id = $1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  try {
    await pool.query('UPDATE action_types SET name=$1, color=$2 WHERE id=$3', [name.toUpperCase().trim(), color || existing.color, req.params.id]);
    const { rows } = await pool.query('SELECT * FROM action_types WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(400).json({ error: 'Action type name must be unique' });
  }
});
app.delete('/api/action-types/:id', requireAuth, async (req, res) => {
  const existing = (await pool.query('SELECT id FROM action_types WHERE id = $1', [req.params.id])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { rows: counts } = await pool.query(
    'SELECT COUNT(*) AS n FROM action_item_action_types WHERE action_type_id = $1',
    [req.params.id]
  );
  const total = parseInt(counts[0].n, 10);
  if (total > 0) {
    return res.status(409).json({
      error: `This action type is still assigned to ${total} action item${total !== 1 ? 's' : ''}. Reassign those items first.`,
    });
  }
  await pool.query('DELETE FROM action_types WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/delegates', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM delegates ORDER BY name');
  res.json(rows);
});

app.get('/api/users', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, initials, role FROM users WHERE active = 1 ORDER BY name');
  res.json(rows);
});

app.use((req, res) => res.status(404).json({ error: `Cannot ${req.method} ${req.path}` }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
