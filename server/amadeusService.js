require('dotenv').config();
const axios = require('axios');

const AMADEUS_BASE = 'https://test.api.amadeus.com';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.AMADEUS_CLIENT_ID);
  params.append('client_secret', process.env.AMADEUS_CLIENT_SECRET);
  const res = await axios.post(`${AMADEUS_BASE}/v1/security/oauth2/token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return cachedToken;
}

async function searchFlights(origin, destination, date) {
  try {
    const token = await getToken();
    console.log(`[amadeus] Searching flights: ${origin} → ${destination} on ${date}`);
    const res = await axios.get(`${AMADEUS_BASE}/v2/shopping/flight-offers`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        originLocationCode: origin.toUpperCase(),
        destinationLocationCode: destination.toUpperCase(),
        departureDate: date,
        adults: 1,
        max: 5,
        currencyCode: 'GBP'
      }
    });
    const offers = res.data.data || [];
    if (!offers.length) {
      console.warn(`[amadeus] No offers returned for ${origin} → ${destination} on ${date} (test API may not have this route)`);
      return null;
    }
    const best = offers[0];
    const price = parseFloat(best.price.total);
    const itinerary = best.itineraries[0];
    const durationRaw = itinerary.duration;
    const duration = parseDuration(durationRaw);
    const stops = itinerary.segments.length - 1;
    console.log(`[amadeus] ✓ ${origin} → ${destination}: ${price.toFixed(2)} GBP, ${duration}, ${stops} stop(s)`);
    return {
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      price: price,
      priceFormatted: `£${price.toFixed(2)}`,
      duration,
      stops,
      date
    };
  } catch (err) {
    const status  = err?.response?.status;
    const detail  = err?.response?.data?.errors?.[0]?.detail || err?.response?.data || err.message;
    if (status === 401) {
      console.error(`[amadeus] ✗ Auth failed (401) for ${origin} → ${destination} — check AMADEUS_CLIENT_ID / SECRET in .env`);
    } else if (status === 400) {
      console.error(`[amadeus] ✗ Bad request (400) for ${origin} → ${destination}: ${JSON.stringify(detail)}`);
    } else {
      console.error(`[amadeus] ✗ Error ${status || '?'} for ${origin} → ${destination}: ${JSON.stringify(detail)}`);
    }
    return null;
  }
}

function parseDuration(iso) {
  if (!iso) return 'N/A';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = match[1] ? `${match[1]}h` : '';
  const m = match[2] ? ` ${match[2]}m` : '';
  return `${h}${m}`.trim() || iso;
}

module.exports = { searchFlights };
