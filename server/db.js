const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'travelbattle.db');
const db = new Database(DB_PATH);

// WAL mode: better performance for concurrent reads/writes
db.pragma('journal_mode = WAL');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username   TEXT PRIMARY KEY,
    password   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leaderboard (
    username   TEXT PRIMARY KEY,
    wins       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS flight_cache (
    cache_key  TEXT PRIMARY KEY,
    result     TEXT NOT NULL,
    cached_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recent_cities (
    city       TEXT PRIMARY KEY,
    country    TEXT,
    price      TEXT,
    duration   TEXT,
    viewed_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS challenge (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    text       TEXT NOT NULL
  );
`);

// Seed default users if the table is empty
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('alice', 'password');
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('bob', 'password');
  console.log('[db] Seeded default users: alice, bob');
}

console.log(`[db] SQLite ready at ${DB_PATH}`);

module.exports = db;
