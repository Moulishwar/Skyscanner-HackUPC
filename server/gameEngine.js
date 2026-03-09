const { searchFlights } = require('./amadeusService');
const { judgeDestinations } = require('./llmService');
const airportService = require('./airportService');

// leaderboard: { username: winCount }
const leaderboard = {};

// current active challenge
let currentChallenge = null;

// Flight result cache: key = `${origin}-${iata}-${date}` → result
const flightCache = {};

// Recently viewed destinations — last 4 unique cities with flight stats
// Each entry: { city, country, priceFormatted, duration }
const recentCities = [];

function getLeaderboard() {
  return Object.entries(leaderboard)
    .sort((a, b) => b[1] - a[1])
    .map(([user, wins]) => ({ user, wins }));
}

function awardWin(username) {
  leaderboard[username] = (leaderboard[username] || 0) + 1;
}

function setChallenge(text) {
  currentChallenge = text;
}

function getChallenge() {
  return currentChallenge;
}

function getRecentCities() {
  return [...recentCities];
}

function addRecentCity(entry) {
  // entry: { city, country, priceFormatted, duration }
  const norm = entry.city.trim().toLowerCase();
  const idx  = recentCities.findIndex(r => r.city.trim().toLowerCase() === norm);
  if (idx !== -1) recentCities.splice(idx, 1);
  recentCities.unshift(entry);
  if (recentCities.length > 4) recentCities.pop();
}

// Parse /battle command: "/battle Paris vs Tokyo vs Barcelona"
function parseBattleCommand(text) {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith('/battle ')) return null;
  const rest = text.slice('/battle '.length).trim();
  if (!rest) return null;
  const destinations = rest.split(/\s+vs\s+/i).map(d => d.trim()).filter(Boolean);
  if (destinations.length < 2) return null;
  return destinations;
}

// Resolve city name or IATA code → IATA
function resolveIata(destination) {
  const upper = destination.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    if (airportService.getByCode(upper)) return upper;
  }
  return airportService.getPrimaryCodeForCity(destination) || null;
}

// Travel date: 30 days from now
function getTravelDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

// Rate-limit-aware sequential fetcher.
// Inserts a 2-second pause after every 4th Amadeus API call to avoid 429s.
let _amadeusCallCount = 0;

async function rateLimitedSearch(origin, iata, date) {
  const key = `${origin}-${iata}-${date}`;
  if (flightCache[key]) {
    console.log(`[gameEngine] Cache hit: ${key}`);
    return flightCache[key];
  }

  _amadeusCallCount++;
  if (_amadeusCallCount % 4 === 0) {
    console.log('[gameEngine] Rate-limit pause (2s) after 4 Amadeus calls…');
    await new Promise(r => setTimeout(r, 2000));
  }

  const result = await searchFlights(origin, iata, date);
  if (result) {
    flightCache[key] = result;
    console.log(`[gameEngine] Cached: ${key}`);
  }
  return result;
}

// Merge flight results from multiple origins for the same destination.
// Returns an averaged/aggregated record, or null if all failed.
function mergeFlightResults(resultsPerOrigin, destination, proposedBy) {
  const valid = resultsPerOrigin.filter(r => r && r.price != null);
  if (!valid.length) return null;

  const avgPrice   = valid.reduce((s, r) => s + r.price, 0) / valid.length;
  const avgMinutes = valid.reduce((s, r) => s + durationToMinutes(r.duration), 0) / valid.length;
  const avgStops   = Math.round(valid.reduce((s, r) => s + (r.stops || 0), 0) / valid.length);

  return {
    destination,
    proposedBy,
    price:          parseFloat(avgPrice.toFixed(2)),
    priceFormatted: `£${avgPrice.toFixed(2)} avg`,
    duration:       minutesToDuration(Math.round(avgMinutes)),
    stops:          avgStops,
    perOrigin:      valid.map(r => ({
      origin:         r.origin,
      price:          r.priceFormatted,
      duration:       r.duration,
      stops:          r.stops
    }))
  };
}

function durationToMinutes(dur) {
  if (!dur || dur === 'N/A') return 0;
  const m = dur.match(/(\d+)h\s*(\d*)m?/);
  if (!m) return 0;
  return parseInt(m[1] || 0) * 60 + parseInt(m[2] || 0);
}

function minutesToDuration(mins) {
  if (!mins) return 'N/A';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

// Core battle function — fetches flights from ALL connected users' origins
// connectedUsersList: [{ username, origin, budget }]
async function runBattle(destinations, proposers, connectedUsersList, fallbackOrigin, budget) {
  const date = getTravelDate();

  // Collect unique origins from all connected users
  const origins = [...new Set(
    (connectedUsersList || []).map(u => (u.origin || fallbackOrigin || 'LHR').toUpperCase())
  )];
  if (!origins.length) origins.push((fallbackOrigin || 'LHR').toUpperCase());

  console.log(`[gameEngine] Battle origins: ${origins.join(', ')}`);

  // Build search tasks: for each destination, fetch from every origin
  // We run them sequentially (not Promise.all) to respect rate-limiting
  const flightResults = [];

  for (let i = 0; i < destinations.length; i++) {
    const dest      = destinations[i];
    const proposedBy = proposers?.[i] || 'unknown';
    const iata      = resolveIata(dest);

    if (!iata) {
      flightResults.push({ destination: dest, proposedBy, error: 'Airport not found — check spelling' });
      continue;
    }

    // Fetch from every origin sequentially
    const perOriginResults = [];
    for (const origin of origins) {
      const r = await rateLimitedSearch(origin, iata, date);
      if (r) perOriginResults.push(r);
    }

    const merged = mergeFlightResults(perOriginResults, dest, proposedBy);
    if (!merged) {
      flightResults.push({ destination: dest, proposedBy, error: `No flights found from ${origins.join('/')}` });
    } else {
      flightResults.push(merged);
    }
  }

  // Track all destinations in recently viewed with rich stats
  for (const f of flightResults) {
    const iata    = resolveIata(f.destination);
    const airport = iata ? airportService.getByCode(iata) : null;
    const country = airport?.country || '';
    addRecentCity({
      city:           f.destination,
      country,
      priceFormatted: f.error ? '—' : (f.priceFormatted || '—'),
      duration:       f.error ? '—' : (f.duration || '—'),
    });
  }

  // Judge via LLM (with built-in fallback to data-based verdict)
  const verdict = await judgeDestinations(
    destinations.map((d, i) => ({ dest: d, user: proposers?.[i] })),
    flightResults,
    budget
  );

  // Extract the recommended destination for leaderboard credit.
  // Handles LLM phrasings like:
  //   "The better option is **Lisbon**"
  //   "better option: Paris"
  //   "winner: Tokyo"
  //   "I declare Tokyo the winner"
  if (verdict) {
    let awardedIdx = -1;

    // Primary: look for "better option is X" / "winner is X" / "winner: X"
    const winnerMatch = verdict.match(
      /(?:better\s+option\s+is|winner\s+is|winner[:\s]+)\s*\*{0,2}([A-Za-z][A-Za-z\s\-']{1,30})\*{0,2}/i
    );
    if (winnerMatch) {
      const winnerDest = winnerMatch[1].trim().toLowerCase();
      awardedIdx = destinations.findIndex(
        d => winnerDest.includes(d.toLowerCase()) || d.toLowerCase().includes(winnerDest)
      );
    }

    // Fallback: find which destination is mentioned most in the verdict
    // (LLMs often repeat the winning destination in the concluding sentence)
    if (awardedIdx === -1) {
      const verdictLower = verdict.toLowerCase();
      const counts = destinations.map(d => {
        const re = new RegExp(d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        return (verdictLower.match(re) || []).length;
      });
      const maxCount = Math.max(...counts);
      if (maxCount > 0) {
        awardedIdx = counts.indexOf(maxCount);
      }
    }

    if (awardedIdx !== -1 && proposers?.[awardedIdx]) {
      console.log(`[gameEngine] Awarding win to ${proposers[awardedIdx]} for ${destinations[awardedIdx]}`);
      awardWin(proposers[awardedIdx]);
    }
  }

  return { verdict, flightResults };
}

module.exports = {
  parseBattleCommand,
  runBattle,
  getLeaderboard,
  awardWin,
  getChallenge,
  setChallenge,
  getRecentCities
};
