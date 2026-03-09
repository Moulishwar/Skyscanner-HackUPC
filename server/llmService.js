require('dotenv').config();
const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Models known to be reasoning/thinking models that consume tokens on internal CoT.
// They need a much higher max_tokens budget so content isn't starved by reasoning.
const REASONING_MODEL_PATTERNS = [
  'step-', 'deepseek-r', 'deepseek/r', 'o1', 'o3', 'thinking', 'reasoner', 'qwq', 'r1'
];

function isReasoningModel(model) {
  const lower = model.toLowerCase();
  return REASONING_MODEL_PATTERNS.some(p => lower.includes(p));
}

async function askLLM(systemPrompt, userContent) {
  const model     = process.env.MODEL || 'openai/gpt-4o-mini';
  const reasoning = isReasoningModel(model);
  // Reasoning models burn tokens on their CoT; give them 4× the budget
  const maxTokens = reasoning ? 2000 : 500;

  console.log(`[llmService] → ${model}${reasoning ? ' (reasoning)' : ''} | max_tokens=${maxTokens} | prompt: ${userContent.slice(0, 120).replace(/\n/g, ' ')}…`);
  try {
    const res = await axios.post(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: maxTokens,
        temperature: reasoning ? 0.6 : 0.8  // lower temp for reasoning models — more focused
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'TravelBattle'
        }
      }
    );
    const content = stripEmDashes(res.data.choices[0]?.message?.content?.trim()) || null;
    const finishReason = res.data.choices[0]?.finish_reason;
    if (content) {
      console.log(`[llmService] ✓ Response (${content.length} chars, finish=${finishReason}): ${content.slice(0, 120).replace(/\n/g, ' ')}…`);
    } else {
      // Log finish_reason so we know if it was a length truncation vs other issue
      console.warn(`[llmService] ⚠ Empty content (finish_reason="${finishReason}") from ${model}.`);
      if (finishReason === 'length') {
        console.warn('[llmService]   → Model hit max_tokens during reasoning. Consider switching to a non-reasoning model or increase max_tokens.');
      }
      const usage = res.data.usage;
      if (usage) console.warn(`[llmService]   → Token usage: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens} (reasoning=${usage.completion_tokens_details?.reasoning_tokens ?? '?'})`);
    }
    return content;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) {
      console.warn('[llmService] ✗ Rate limited (429) — fallback will be used.');
    } else if (status === 401) {
      console.error('[llmService] ✗ Unauthorized (401) — check OPENROUTER_API_KEY in .env');
    } else {
      console.error(`[llmService] ✗ HTTP ${status || '?'} error:`, JSON.stringify(err?.response?.data || err.message));
    }
    return null;
  }
}

// Strip em-dashes that some LLMs insert despite instructions
function stripEmDashes(text) {
  if (!text) return text;
  return text.replace(/ — /g, ', ').replace(/ —/g, ',').replace(/— /g, '');
}

/** Builds a verdict purely from flight data when the LLM is unavailable. */
function buildFallbackVerdict(flightData) {
  const valid = flightData.filter(f => !f.error && f.price != null);
  if (valid.length === 0) {
    return '⚔ DESTINATION BATTLE ⚔\n\nNo flight data available — check origin/dates or try again.';
  }
  const sorted = [...valid].sort((a, b) => a.price - b.price);
  const winner = sorted[0];
  const lines = valid.map(f =>
    `${f.destination}\nPrice: ${f.priceFormatted || '£' + f.price.toFixed(2)}\nFlight time: ${f.duration || 'N/A'}\n`
  ).join('\n');
  return `⚔ DESTINATION BATTLE ⚔\n\n${lines}✅ The better option is: ${winner.destination}\n\nReason: cheapest average flight${winner.duration ? ' and best travel time' : ''}. (Verdict by data — AI was unavailable.)`;
}

// ── Prompt 1: Travel Judge ──────────────────────────────────────────────────
const TRAVEL_JUDGE_SYSTEM = `You are the TravelBattle Judge, a witty AI referee for travel debates.
Users propose destinations they want to travel to.
You receive destination names, average flight prices across all players' origins, flight durations, and the users who proposed them.
Your job is to determine the best destination for the group.
Evaluate destinations based on: 1) Cheapest average price, 2) Shortest average travel time, 3) Overall destination appeal.
Respond in a game show style verdict. Be humorous but concise.
Assume all prices are in GBP (£). Use emojis sparingly.
IMPORTANT: Do NOT say "winner". Instead always say "The better option is [destination]" when stating your recommendation.`;

async function judgeDestinations(proposals, flightData, budget) {
  const budgetLine = budget ? `\nGroup budget per person: £${budget}` : '';
  const flightInfo = flightData.map(f => {
    const label = `${f.destination} (proposed by ${f.proposedBy})`;
    if (f.error) return `${label}: No flights found`;
    let line = `${label}: Avg Price ${f.priceFormatted}, Avg Duration ${f.duration}, Avg Stops ${f.stops}`;
    if (f.perOrigin?.length > 1) {
      const breakdown = f.perOrigin.map(o => `  ${o.origin}: ${o.price}, ${o.duration}, ${o.stops} stop(s)`).join('\n');
      line += `\n  Per-origin breakdown:\n${breakdown}`;
    }
    return line;
  }).join('\n');
  const userContent = `Destinations being compared:${budgetLine}\n\n${flightInfo}\n\nProvide your verdict. Remember to say "The better option is [destination]" not "winner".`;
  const verdict = await askLLM(TRAVEL_JUDGE_SYSTEM, userContent);
  if (verdict) return verdict;
  return buildFallbackVerdict(flightData);
}

// ── Prompt 2: Travel Personality Generator ─────────────────────────────────
const PERSONALITY_SYSTEM = `You assign humorous travel personalities to players.
Each personality should be short, funny, and travel-themed.
Examples: Budget Pirate, Luxury Escapist, Backpacking Goblin, Airport Lounge Aristocrat, Weekend Wanderer, Jetlag Gladiator.
Return ONLY the personality title, nothing else.`;

const FALLBACK_PERSONALITIES = [
  'Budget Pirate', 'Luxury Escapist', 'Backpacking Goblin',
  'Weekend Wanderer', 'Jetlag Gladiator', 'Travel Enthusiast'
];

async function generatePersonality(username) {
  const p = await askLLM(PERSONALITY_SYSTEM, `Generate a travel personality for user: ${username}`);
  if (p) return p;
  const i = username.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return FALLBACK_PERSONALITIES[i % FALLBACK_PERSONALITIES.length];
}

// ── Prompt 3: Travel Challenge Generator ───────────────────────────────────
const CHALLENGE_SYSTEM = `You are the TravelBattle Dungeon Master.
Generate a single travel challenge players must solve using real flight searches.
Challenges must be specific, competitive, and achievable.
Return ONLY the challenge text starting with "🎯 Challenge:". Keep it under 2 sentences.`;

const FALLBACK_CHALLENGES = [
  '🎯 Challenge: Find a European destination under £200 return.',
  '🎯 Challenge: Find the warmest destination reachable under £150.',
  '🎯 Challenge: Find the longest flight under £300.',
  '🎯 Challenge: Find the cheapest direct flight from your origin.'
];

async function generateChallenge(origins = []) {
  const originsText = origins.length
    ? `Players are departing from: ${origins.join(' and ')}. `
    : '';
  const prompt = `${originsText}Generate a single travel challenge tailored to these departure airports.`;
  const c = await askLLM(CHALLENGE_SYSTEM, prompt);
  if (c) return c;
  return FALLBACK_CHALLENGES[Math.floor(Math.random() * FALLBACK_CHALLENGES.length)];
}

// ── Prompt 4: Destination Suggestion ───────────────────────────────────────
const SUGGESTION_SYSTEM = `You are a witty, opinionated travel buddy — not a corporate information bot.
You know the players by name, where they're flying from, and how much they're willing to spend.
Your job is to suggest up to 3 destinations that genuinely make sense given their origins and budgets.

Rules:
- Address the players by name and acknowledge their specific situation (e.g. "Since Alice is flying from London and Bob from Barcelona…")
- Be warm, fun, and direct — have an actual opinion, like a knowledgeable friend giving advice
- If a player's own city (or a neighbouring one) is the obvious best pick, say so and explain why it saves them money
- Respect their budgets: if someone has a tight budget, flag cheap options; if the query makes budget irrelevant, skip it
- Suggest only as many destinations as genuinely make sense for the query — if only 1 or 2 fit, that's fine; do not pad with irrelevant places just to hit 3
- If the user is being silly or testing you (e.g. "/suggest north pole"), play along with a funny but honest reply
- At the end of your response, casually invite them to use /battle to compare real flight prices (one natural sentence, not a hard sell)
- Output plain text only. No markdown, no bullet points, no asterisks, no em-dashes (—).`;


// ── Prompt 4b: Direct city comparison ─────────────────────────────────────
const COMPARISON_SYSTEM = `You are a witty, opinionated travel buddy who knows the players by name.
A user is asking you to compare two or more specific cities — answer their exact question directly.
Do NOT ignore the cities they mentioned or swap them out for your own picks.
Consider: flight accessibility from each player's origin, cost relative to their budget, climate, things to do, and overall vibe.
Be warm, direct, and have an actual opinion — like a well-travelled friend, not a FAQ page.
End with a natural nudge to use /battle for real flight data.
Output plain text only. No markdown, no bullet points, no asterisks, no em-dashes (—).`;

// Returns true if the context looks like a comparison question rather than a suggestion request
function isComparisonQuery(context) {
  const lower = context.toLowerCase();
  return (
    (lower.includes(' or ') || lower.includes(' vs ') || lower.includes(' versus ')) &&
    (lower.includes('better') || lower.includes('which') || lower.includes('compare') || lower.includes('prefer'))
  );
}

async function suggestDestinations(conversationContext, userOrigins = []) {
  const airportService = require('./airportService');

  // Build a rich, personal context string: name + city + budget per player
  let playersLine = '';
  if (userOrigins.length > 0) {
    const parts = userOrigins.map(u => {
      const airport = airportService.getByCode(u.origin);
      const cityLabel = airport ? `${airport.city} (${u.origin})` : (u.origin || 'unknown city');
      const budgetLabel = u.budget ? ` with a budget of £${u.budget}` : '';
      return `${u.username} is flying from ${cityLabel}${budgetLabel}`;
    });
    playersLine = `Players: ${parts.join('; ')}.\n`;
  }

  // Route comparison questions to a targeted prompt so the LLM answers the actual question
  if (conversationContext && isComparisonQuery(conversationContext)) {
    const prompt = `${playersLine}The user asks: "${conversationContext}"`;
    const answer = await askLLM(COMPARISON_SYSTEM, prompt);
    if (answer) return answer;
    return `Based on the available information, both are excellent choices. Consider your priorities: cost, travel time, and what you want to do there — then use /battle to get a data-driven verdict with real flight prices!`;
  }

  const request = conversationContext
    ? `The user asked: "${conversationContext}"`
    : 'Suggest up to 3 destinations that genuinely make sense for these players.';
  const prompt = `${playersLine}${request}`;

  const s = await askLLM(SUGGESTION_SYSTEM, prompt);
  if (s) return s;

  // Fallback — simple geography-based suggestions
  const knownEU = new Set(['LHR','LGW','MAN','CDG','AMS','BRU','FRA','MUC','BCN','MAD','FCO','LIS','DUB','VIE','ZRH','CPH','ARN','OSL','HEL','PRG','WAW','BUD','ATH']);
  const origins = userOrigins.map(u => (u.origin || '').toUpperCase());
  const allEU = origins.length > 0 && origins.every(o => knownEU.has(o));

  if (allEU) {
    return 'Porto, Portugal — charming riverside city, excellent wine, cheap from most European airports.\nKrakow, Poland — stunning old town, very affordable, well-connected from Western Europe.\nDubrovnik, Croatia — gorgeous Adriatic coastline, reachable from major European hubs.\nWant to compare them? Use /battle to get real flight prices!';
  }
  return 'Lisbon, Portugal — great food, warm weather, well-priced flights from Europe.\nRome, Italy — stunning history, central location, easy to reach from almost anywhere.\nBarcelona, Spain — beaches, architecture, and excellent food scene.\nGive /battle a go to see which one wins on price!';
}

// ── Prompt 5: Debate Commentary ────────────────────────────────────────────
const COMMENTARY_SYSTEM = `You are a sarcastic but friendly travel commentator watching friends argue about travel plans.
Add playful commentary about their choices. Keep responses under 2 sentences. Use emojis sparingly.`;

async function commentOnDebate(context) {
  return askLLM(COMMENTARY_SYSTEM, context);
}

module.exports = {
  judgeDestinations,
  generatePersonality,
  generateChallenge,
  suggestDestinations,
  commentOnDebate
};
