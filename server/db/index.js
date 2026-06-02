const Database = require('better-sqlite3');
const path = require('path');

// In production (Railway), set DB_PATH to a path on the persistent volume, e.g. /data/bgmoffice.db
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bgmoffice.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

module.exports = db;
