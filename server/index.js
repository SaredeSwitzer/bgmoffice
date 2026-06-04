require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// Uploads directory — must be on the persistent volume in production
const UPLOADS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/server/data/uploads'
  : path.join(__dirname, 'db', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();

// Allow the Netlify frontend. ALLOWED_ORIGIN can be a comma-separated list.
// Falls back to bgmoffice.netlify.app so it works even if the env var isn't set.
const rawOrigins = process.env.ALLOWED_ORIGIN || 'https://bgmoffice.netlify.app';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, Railway health checks)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve uploaded files (photos, documents)
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/instructors',  require('./routes/instructors'));
console.log('[routes] /api/instructors registered (photo + document upload enabled)');
app.use('/api/cases',        require('./routes/cases'));
app.use('/api/action-items', require('./routes/actionItems'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/reminders',    require('./routes/reminders'));
app.use('/api/reference',    require('./routes/reference'));
app.use('/api/recruiting',   require('./routes/recruiting'));
app.use('/api/tasks',        require('./routes/tasks'));

// Action type lookups + all-user management (any authenticated user may edit)
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
app.get('/api/action-types', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM action_types ORDER BY order_index ASC').all())
);
app.post('/api/action-types', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM action_types').get().m || 0;
  try {
    const result = db.prepare(
      'INSERT INTO action_types (name, color, order_index) VALUES (?, ?, ?)'
    ).run(name.toUpperCase().trim(), color || 'gray', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM action_types WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Action type name must be unique' });
  }
});
app.put('/api/action-types/:id', requireAuth, (req, res) => {
  const { name, color } = req.body;
  const at = db.prepare('SELECT * FROM action_types WHERE id = ?').get(req.params.id);
  if (!at) return res.status(404).json({ error: 'Not found' });
  try {
    db.prepare('UPDATE action_types SET name=?, color=? WHERE id=?')
      .run(name.toUpperCase().trim(), color || at.color, req.params.id);
    res.json(db.prepare('SELECT * FROM action_types WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: 'Action type name must be unique' });
  }
});
app.delete('/api/action-types/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM action_types WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.get('/api/delegates', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM delegates ORDER BY name').all())
);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// JSON error handler — must be last, catches all thrown errors and next(err) calls
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
