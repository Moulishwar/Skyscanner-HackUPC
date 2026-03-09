require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const { setupAuthRoutes } = require('./auth');
const { setupChat } = require('./chat');
const airportService = require('./airportService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// Auth routes
setupAuthRoutes(app);

// Airport search API (by code, name, city, country — for settings)
app.get('/api/airports', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ results: [] });
  const results = airportService.searchAirports(q);
  res.json({ results });
});

// City search API — returns unique city names whose name STARTS WITH the query
app.get('/api/cities', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json({ results: [] });
  const results = airportService.getCitiesStartingWith(q);
  res.json({ results });
});

// Leaderboard snapshot (REST fallback)
app.get('/api/leaderboard', (req, res) => {
  const { getLeaderboard } = require('./gameEngine');
  res.json({ leaderboard: getLeaderboard() });
});

// Setup WebSocket chat
setupChat(io);

// SPA fallback — serve index.html for all unmatched GET routes
app.get('*', (req, res) => {
  const clientDir = path.join(__dirname, '..', 'client');
  const routes = {
    '/group-trip': 'group-trip.html',
    '/login': 'login.html',
    '/chat': 'chat.html'
  };
  const file = routes[req.path];
  if (file) return res.sendFile(path.join(clientDir, file));
  res.sendFile(path.join(clientDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌍 TravelBattle server running at http://localhost:${PORT}\n`);
  console.log('  Homepage    → http://localhost:' + PORT);
  console.log('  Group Trip  → http://localhost:' + PORT + '/group-trip');
  console.log('  Login       → http://localhost:' + PORT + '/login');
  console.log('  Chat Room   → http://localhost:' + PORT + '/chat\n');
});
