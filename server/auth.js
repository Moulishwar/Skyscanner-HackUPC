const { v4: uuidv4 } = require('uuid');
const db = require('./db');

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || user.password !== password) return null;
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .run(token, user.username, Date.now());
  return token;
}

function validateToken(token) {
  const row = db.prepare('SELECT username FROM sessions WHERE token = ?').get(token);
  return row ? { username: row.username } : null;
}

function getUserList() {
  return db.prepare('SELECT username FROM users').all().map(r => r.username);
}

function setupAuthRoutes(app) {
  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    const token = login(username.trim(), password);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    return res.json({ success: true, user: username.toLowerCase(), token });
  });

  app.get('/users', (req, res) => {
    res.json({ users: getUserList() });
  });
}

module.exports = { setupAuthRoutes, validateToken, login };
