const { suggestDestinations, commentOnDebate, generateChallenge } = require('./llmService');
const { parseBattleCommand, runBattle, getLeaderboard, getChallenge, setChallenge, getRecentCities } = require('./gameEngine');

// connected users: socketId → { username, origin, budget }
const connectedUsers = {};

// username → timer handle for delayed "left the room" announcements
const pendingLeave = {};

function getOnlineUsers() {
  return Object.values(connectedUsers).map(u => ({
    username: u.username,
    origin: u.origin,
    budget: u.budget
  }));
}

// recent messages buffer (last 50)
const messageHistory = [];

// Whether the one-per-session challenge has been issued
let challengeIssued = false;

// Active vote sessions: battleId → { destinations, proposer, proposers, votes, timer, resolve }
const activeBattles = {};

function addToHistory(msg) {
  messageHistory.push(msg);
  if (messageHistory.length > 50) messageHistory.shift();
}

function setupChat(io) {
  io.on('connection', (socket) => {
    console.log(`[chat] socket connected: ${socket.id}`);

    // Send history to newly connected socket
    socket.emit('history', messageHistory);

    // ── Join event ────────────────────────────────────────────────────────
    socket.on('join', async ({ username, origin, budget }) => {
      if (!username) return;

      // If a pending leave timer exists, this is a refresh/quick reconnect — silent rejoin
      const isReconnect = !!pendingLeave[username];
      if (isReconnect) {
        clearTimeout(pendingLeave[username]);
        delete pendingLeave[username];
      }

      connectedUsers[socket.id] = {
        username,
        origin: (origin || 'LHR').toUpperCase(),
        budget: budget || null
      };

      // Only announce join for genuine new arrivals (not page refreshes)
      if (!isReconnect) {
        const joinMsg = {
          type: 'system',
          text: `✈️ ${username} joined the chat`,
          timestamp: Date.now()
        };
        addToHistory(joinMsg);
        io.emit('message', joinMsg);
      }

      // Acknowledge join
      socket.emit('joined', { username });

      // Send leaderboard
      socket.emit('leaderboard', getLeaderboard());
      // Broadcast updated online users list to everyone
      io.emit('onlineUsers', getOnlineUsers());
      // Send recently viewed cities to the joining user
      socket.emit('recentCities', getRecentCities());

      // ── Fire ONE challenge when 2+ users are in the room ──────────────
      // Short delay ensures all join messages reach clients before the challenge bubble
      const userCount = Object.keys(connectedUsers).length;
      if (userCount >= 2 && !challengeIssued) {
        challengeIssued = true;
        const origins = [...new Set(
          Object.values(connectedUsers).map(u => u.origin).filter(Boolean)
        )];
        setTimeout(async () => {
          try {
            const challenge = await generateChallenge(origins);
            if (challenge) {
              setChallenge(challenge);
              const msg = { type: 'challenge', text: challenge, timestamp: Date.now() };
              addToHistory(msg);
              io.emit('message', msg);
            }
          } catch (e) {
            console.error('[chat] challenge error:', e.message);
          }
        }, 600);
      }
    });

    // ── Update settings ───────────────────────────────────────────────────
    socket.on('updateSettings', ({ origin, budget }) => {
      const user = connectedUsers[socket.id];
      if (!user) return;
      if (origin) user.origin = origin.toUpperCase();
      if (budget !== undefined) user.budget = budget;
      socket.emit('settingsUpdated', { origin: user.origin, budget: user.budget });
      // Broadcast updated list so other users see the new origin
      io.emit('onlineUsers', getOnlineUsers());
    });

    // ── Vote on an active battle ───────────────────────────────────────────
    socket.on('battleVote', ({ battleId, choice }) => {
      const user = connectedUsers[socket.id];
      if (!user) return;
      const battle = activeBattles[battleId];
      if (!battle) return;

      battle.votes[user.username] = choice;
      console.log(`[chat] Vote from ${user.username}: ${choice} (battleId: ${battleId})`);

      // Broadcast updated vote tally to everyone
      io.emit('battleVoteUpdate', {
        battleId,
        votes: battle.votes,
        total: Object.keys(connectedUsers).length
      });

      // If everyone has voted, resolve immediately without waiting for timer
      const totalUsers = Object.keys(connectedUsers).length;
      const votedCount = Object.keys(battle.votes).length;
      if (votedCount >= totalUsers) {
        console.log(`[chat] All ${totalUsers} user(s) voted — proceeding immediately`);
        battle.resolve('all_voted');
      }
    });

    // ── Chat message ──────────────────────────────────────────────────────
    socket.on('chatMessage', async ({ text }) => {
      const user = connectedUsers[socket.id];
      if (!user || !text?.trim()) return;

      const trimmed = text.trim();

      // ── /battle command ────────────────────────────────────────────────
      const battleDests = parseBattleCommand(trimmed);
      if (battleDests) {
        const userMsg = {
          type: 'chat',
          user: user.username,
          text: trimmed,
          timestamp: Date.now()
        };
        addToHistory(userMsg);
        io.emit('message', userMsg);

        const startMsg = {
          type: 'system',
          text: `⚔️ ${user.username} started a battle: ${battleDests.join(' vs ')}`,
          timestamp: Date.now()
        };
        addToHistory(startMsg);
        io.emit('message', startMsg);

        io.emit('battleStarted', { destinations: battleDests });

        // ── 10-second voting window ──────────────────────────────────────
        const battleId   = `battle_${Date.now()}`;
        const totalUsers = Object.keys(connectedUsers).length;

        // Only open a vote if there are 2+ users; single-user room skips voting
        let votes = {};

        if (totalUsers > 1) {
          // Emit vote request to all clients
          const voteMsg = {
            type: 'battleVote',
            battleId,
            destinations: battleDests,
            timeoutMs: 10000,
            timestamp: Date.now()
          };
          addToHistory(voteMsg);
          io.emit('message', voteMsg);
          io.emit('battleVoteOpen', { battleId, destinations: battleDests, timeoutMs: 10000 });

          // Wait up to 10 seconds or until all votes are in
          votes = await new Promise(resolve => {
            const voteState = {
              destinations: battleDests,
              proposer: user.username,
              votes,
              timer: null,
              resolve: null
            };

            voteState.resolve = (reason) => {
              clearTimeout(voteState.timer);
              // Capture votes BEFORE deleting — votes object is shared by reference
              const finalVotes = { ...voteState.votes };
              delete activeBattles[battleId];
              resolve(finalVotes);
            };

            voteState.timer = setTimeout(() => {
              console.log(`[chat] Vote timeout reached for ${battleId}`);
              const finalVotes = { ...voteState.votes };
              delete activeBattles[battleId];
              resolve(finalVotes);
            }, 10000);

            activeBattles[battleId] = voteState;
          });

          io.emit('battleVoteClosed', { battleId, votes });

          // Announce vote results
          const voteCount = Object.keys(votes).length;
          if (voteCount > 0) {
            const tally = battleDests.map(d => {
              const count = Object.values(votes).filter(v => v === d).length;
              return `${d}: ${count} vote(s)`;
            }).join(', ');
            const voteResultMsg = {
              type: 'system',
              text: `🗳️ Votes cast (${voteCount}/${totalUsers}): ${tally} — proceeding to battle!`,
              timestamp: Date.now()
            };
            addToHistory(voteResultMsg);
            io.emit('message', voteResultMsg);
          } else {
            const noVoteMsg = {
              type: 'system',
              text: `⏱️ No votes received — proceeding with battle automatically`,
              timestamp: Date.now()
            };
            addToHistory(noVoteMsg);
            io.emit('message', noVoteMsg);
          }
        }

        // ── Determine proposers from votes (or fall back to initiator) ──
        // Each voter's choice is attributed to that voter as "proposer"
        // for leaderboard purposes. If no votes, everyone is the initiator.
        const proposerMap = {};
        if (Object.keys(votes).length > 0) {
          // Map each destination to the user(s) who voted for it
          for (const [voter, choice] of Object.entries(votes)) {
            if (!proposerMap[choice]) proposerMap[choice] = voter;
          }
        }
        const proposers = battleDests.map(d => proposerMap[d] || user.username);

        try {
          // Pass ALL connected users so flights are fetched from every origin
          const connectedList = Object.values(connectedUsers);
          const budget = user.budget;

          const { verdict, flightResults } = await runBattle(
            battleDests,
            proposers,
            connectedList,
            user.origin,
            budget
          );

          const verdictMsg = {
            type: 'verdict',
            text: verdict || 'No verdict available.',
            flightResults,
            timestamp: Date.now()
          };
          addToHistory(verdictMsg);
          io.emit('message', verdictMsg);
          io.emit('leaderboard', getLeaderboard());
          const recent = getRecentCities();
          console.log(`[gameEngine] Recent cities: ${recent.map(r => r.city).join(', ')}`);
          io.emit('recentCities', recent);
        } catch (err) {
          console.error('[chat] battle error:', err.message);
          io.emit('message', {
            type: 'system',
            text: '⚠️ Battle failed — check Amadeus API keys in .env',
            timestamp: Date.now()
          });
        }
        return;
      }

      // ── /suggest command ───────────────────────────────────────────────
      if (trimmed.toLowerCase().startsWith('/suggest')) {
        const userMsg = { type: 'chat', user: user.username, text: trimmed, timestamp: Date.now() };
        addToHistory(userMsg);
        io.emit('message', userMsg);
        // Signal all clients to show the loading spinner
        io.emit('suggestStarted');
        try {
          const context = trimmed.slice('/suggest'.length).trim() || '';
          // Pass all connected users' origins for geography-aware suggestions
          const userOrigins = getOnlineUsers();
          const suggestions = await suggestDestinations(context, userOrigins);
          const sugMsg = { type: 'verdict', text: suggestions || 'No suggestions available.', timestamp: Date.now() };
          addToHistory(sugMsg);
          io.emit('message', sugMsg);
        } catch (e) {
          console.error('[chat] suggest error:', e.message);
        }
        return;
      }

      // ── Regular message ────────────────────────────────────────────────
      const chatMsg = {
        type: 'chat',
        user: user.username,
        text: trimmed,
        timestamp: Date.now()
      };
      addToHistory(chatMsg);
      io.emit('message', chatMsg);

      // Occasional AI commentary on debate-like messages
      const debateKeywords = ['vs', 'better', 'cheaper', 'prefer', 'rather', 'instead', 'beat', 'win'];
      const hasDebate = debateKeywords.some(kw => trimmed.toLowerCase().includes(kw));
      if (hasDebate && Math.random() < 0.4) {
        try {
          const comment = await commentOnDebate(`${user.username}: ${trimmed}`);
          if (comment) {
            const commentMsg = { type: 'ai-comment', text: comment, timestamp: Date.now() };
            addToHistory(commentMsg);
            io.emit('message', commentMsg);
          }
        } catch (e) {
          console.error('[chat] commentary error:', e.message);
        }
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const user = connectedUsers[socket.id];
      if (!user) return;

      // Remove from connected map immediately so the room count is accurate
      delete connectedUsers[socket.id];

      // Delay the "left" announcement by 10s — cancels if same user rejoins
      const username = user.username;
      if (pendingLeave[username]) clearTimeout(pendingLeave[username]);

      pendingLeave[username] = setTimeout(() => {
        delete pendingLeave[username];
        // Only announce if the user hasn't reconnected under the same name
        const stillHere = Object.values(connectedUsers).some(u => u.username === username);
        if (stillHere) return;

        const leaveMsg = {
          type: 'system',
          text: `👋 ${username} left the room`,
          timestamp: Date.now()
        };
        addToHistory(leaveMsg);
        io.emit('message', leaveMsg);
        io.emit('leaderboard', getLeaderboard());
        io.emit('onlineUsers', getOnlineUsers());

        if (Object.keys(connectedUsers).length === 0) {
          challengeIssued = false;
        }
      }, 10000);
    });
  });
}

module.exports = { setupChat };
