require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/instructors',  require('./routes/instructors'));
app.use('/api/cases',        require('./routes/cases'));
app.use('/api/action-items', require('./routes/actionItems'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/dashboard',    require('./routes/dashboard'));

// Public read-only lookups (needed by forms before settings auth is checked)
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
app.get('/api/action-types', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM action_types ORDER BY order_index ASC').all())
);
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
