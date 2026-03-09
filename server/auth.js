const { v4: uuidv4 } = require('uuid');

const USERS = {
  alice: { password: 'password' },
  bob: { password: 'password' }
};

// token → { username, createdAt }
const sessions = {};

function login(username, password) {
  const user = USERS[username.toLowerCase()];
  if (!user || user.password !== password) return null;
  const token = uuidv4();
  sessions[token] = { username: username.toLowerCase(), createdAt: Date.now() };
  return token;
}

function validateToken(token) {
  return sessions[token] || null;
}

function getUserList() {
  return Object.keys(USERS);
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
