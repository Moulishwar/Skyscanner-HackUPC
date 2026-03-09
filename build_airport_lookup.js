/**
 * build_airport_lookup.js
 *
 * Pipeline: airport.csv → airports_lookup.csv
 *
 * Reads airport.csv (the full OurAirports dataset), filters to only
 * large/medium airports with scheduled service and a valid IATA code,
 * normalises city names, resolves known aliases (Tokyo → NRT, Milan → MXP, etc.),
 * and writes airports_lookup.csv with columns:
 *   iata, name, city, city_norm, country, continent, type, lat, lon
 *
 * "city_norm" is the accent-stripped, lower-cased form used for look-ups so that
 * "São Paulo" matches "sao paulo", "Ferno (VA)" maps to "Milan", etc.
 *
 * Usage:  node build_airport_lookup.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Tiny RFC-4180 CSV parser (handles quoted fields with embedded commas/newlines)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows  = [];
  let   cur   = '';
  let   row   = [];
  let   inQ   = false;

  for (let i = 0; i < text.length; i++) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQ) {
      if (ch === '"' && next === '"') { cur += '"'; i++; }
      else if (ch === '"')            { inQ = false; }
      else                            { cur += ch; }
    } else {
      if      (ch === '"')  { inQ = true; }
      else if (ch === ',')  { row.push(cur); cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else                  { cur += ch; }
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------------------
// Accent / diacritic normalisation  (works in Node without ICU flags)
// ---------------------------------------------------------------------------
function stripAccents(str) {
  return str
    .normalize('NFD')                     // decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')      // strip combining marks
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Municipality → canonical city  alias map
//
// Keys are accent-stripped lower-case municipality strings (or substrings).
// Values are the clean city name that users will type.
//
// This handles:
//  • "paris (roissy-en-france, val-d'oise)"  → "Paris"
//  • "ferno (va)"                            → "Milan"   (MXP)
//  • "narita"                                → "Tokyo"   (NRT)
//  • "spata-artemida"                        → "Athens"  (ATH)
//  • etc.
// ---------------------------------------------------------------------------
const MUNICIPALITY_ALIAS = {
  // France
  'paris (roissy-en-france':          'Paris',
  'paris (orly':                      'Paris',
  'paris le bourget':                 'Paris',
  // Italy
  'ferno (va)':                       'Milan',
  'ferno':                            'Milan',
  'rome':                             'Rome',
  'rome (fiumicino)':                 'Rome',
  // Japan
  'narita':                           'Tokyo',
  'incheon':                          'Seoul',     // ICN is in Incheon city
  // Greece
  'spata-artemida':                   'Athens',
  'spata':                            'Athens',
  // Germany
  'frankfurt am main':                'Frankfurt',
  // Netherlands
  'haarlemmermeer':                   'Amsterdam', // Schiphol is in Haarlemmermeer
  // USA
  'new york':                         'New York',
  'queens':                           'New York',
  'los angeles':                      'Los Angeles',
  'chicago':                          'Chicago',
  'miami':                            'Miami',
  'houston':                          'Houston',
  'san francisco':                    'San Francisco',
  'dallas':                           'Dallas',
  'washington':                       'Washington',
  'atlanta':                          'Atlanta',
  'boston':                           'Boston',
  'seattle':                          'Seattle',
  'las vegas':                        'Las Vegas',
  'denver':                           'Denver',
  'minneapolis':                      'Minneapolis',
  'detroit':                          'Detroit',
  'phoenix':                          'Phoenix',
  'orlando':                          'Orlando',
  'charlotte':                        'Charlotte',
  'portland':                         'Portland',
  'salt lake city':                   'Salt Lake City',
  'san diego':                        'San Diego',
  'honolulu':                         'Honolulu',
  'anchorage':                        'Anchorage',
  // Canada
  'toronto':                          'Toronto',
  'montreal':                         'Montreal',
  'vancouver':                        'Vancouver',
  'calgary':                          'Calgary',
  'ottawa':                           'Ottawa',
  // Latin America
  'sao paulo':                        'São Paulo',
  'são paulo':                        'São Paulo',
  'rio de janeiro':                   'Rio de Janeiro',
  'buenos aires':                     'Buenos Aires',
  'bogota':                           'Bogotá',
  'bogotá':                           'Bogotá',
  'lima':                             'Lima',
  'santiago':                         'Santiago',
  'mexico city':                      'Mexico City',
  // Middle East / Africa
  'dubai':                            'Dubai',
  'abu dhabi':                        'Abu Dhabi',
  'doha':                             'Doha',
  'riyadh':                           'Riyadh',
  'tel aviv':                         'Tel Aviv',
  'cairo':                            'Cairo',
  'nairobi':                          'Nairobi',
  'johannesburg':                     'Johannesburg',
  'cape town':                        'Cape Town',
  'casablanca':                       'Casablanca',
  'addis ababa':                      'Addis Ababa',
  'lagos':                            'Lagos',
  'accra':                            'Accra',
  // Asia-Pacific
  'beijing':                          'Beijing',
  'shanghai':                         'Shanghai',
  'guangzhou':                        'Guangzhou',
  'shenzhen':                         'Shenzhen',
  'chengdu':                          'Chengdu',
  'hong kong':                        'Hong Kong',
  'macau':                            'Macau',
  'singapore':                        'Singapore',
  'bangkok':                          'Bangkok',
  'kuala lumpur':                     'Kuala Lumpur',
  'jakarta':                          'Jakarta',
  'manila':                           'Manila',
  'ho chi minh city':                 'Ho Chi Minh City',
  'hanoi':                            'Hanoi',
  'taipei':                           'Taipei',
  'osaka':                            'Osaka',
  'fukuoka':                          'Fukuoka',
  'sapporo':                          'Sapporo',
  'delhi':                            'Delhi',
  'mumbai':                           'Mumbai',
  'bangalore':                        'Bangalore',
  'chennai':                          'Chennai',
  'hyderabad':                        'Hyderabad',
  'kolkata':                          'Kolkata',
  'islamabad':                        'Islamabad',
  'karachi':                          'Karachi',
  'dhaka':                            'Dhaka',
  'colombo':                          'Colombo',
  'kathmandu':                        'Kathmandu',
  'yangon':                           'Yangon',
  'phnom penh':                       'Phnom Penh',
  'vientiane':                        'Vientiane',
  'ulaanbaatar':                      'Ulaanbaatar',
  'almaty':                           'Almaty',
  'tashkent':                         'Tashkent',
  // Oceania
  'sydney':                           'Sydney',
  'melbourne':                        'Melbourne',
  'brisbane':                         'Brisbane',
  'perth':                            'Perth',
  'auckland':                         'Auckland',
  // Europe
  'london':                           'London',
  'madrid':                           'Madrid',
  'barcelona':                        'Barcelona',
  'amsterdam':                        'Amsterdam',
  'paris':                            'Paris',
  'rome':                             'Rome',
  'milan':                            'Milan',
  'munich':                           'Munich',
  'berlin':                           'Berlin',
  'frankfurt':                        'Frankfurt',
  'vienna':                           'Vienna',
  'zurich':                           'Zurich',
  'geneva':                           'Geneva',
  'brussels':                         'Brussels',
  'stockholm':                        'Stockholm',
  'oslo':                             'Oslo',
  'copenhagen':                       'Copenhagen',
  'helsinki':                         'Helsinki',
  'warsaw':                           'Warsaw',
  'krakow':                           'Krakow',
  'prague':                           'Prague',
  'budapest':                         'Budapest',
  'bucharest':                        'Bucharest',
  'sofia':                            'Sofia',
  'athens':                           'Athens',
  'lisbon':                           'Lisbon',
  'porto':                            'Porto',
  'dublin':                           'Dublin',
  'edinburgh':                        'Edinburgh',
  'manchester':                       'Manchester',
  'birmingham':                       'Birmingham',
  'glasgow':                          'Glasgow',
  'bologna':                          'Bologna',
  'venice':                           'Venice',
  'naples':                           'Naples',
  'florence':                         'Florence',
  'seville':                          'Seville',
  'valencia':                         'Valencia',
  'malaga':                           'Malaga',
  'bilbao':                           'Bilbao',
  'zagreb':                           'Zagreb',
  'dubrovnik':                        'Dubrovnik',
  'split':                            'Split',
  'belgrade':                         'Belgrade',
  'sarajevo':                         'Sarajevo',
  'skopje':                           'Skopje',
  'tirana':                           'Tirana',
  'riga':                             'Riga',
  'tallinn':                          'Tallinn',
  'vilnius':                          'Vilnius',
  'istanbul':                         'Istanbul',
  'ankara':                           'Ankara',
  'izmir':                            'Izmir',
  'antalya':                          'Antalya',
  'reykjavik':                        'Reykjavik',
  'luxembourg':                       'Luxembourg',
  'valletta':                         'Valletta',
  'nicosia':                          'Nicosia',
};

// ---------------------------------------------------------------------------
// Airport-name keywords that indicate the entry is NOT a commercial airport
// (train stations, ferry ports, bus terminals, heliports, etc.)
// ---------------------------------------------------------------------------
const NON_AIRPORT_KEYWORDS = [
  'station', 'railway', 'terminal', 'centraal', 'nadrazi',
  'gare', 'hauptbahnhof', 'bus', 'ferry', 'harbor', 'harbour',
  'heliport', 'pad', 'all airports', 'metropolitan area',
];

function isNonAirport(name) {
  const n = name.toLowerCase();
  return NON_AIRPORT_KEYWORDS.some(k => n.includes(k));
}

// ---------------------------------------------------------------------------
// Preferred gateway airport for cities with multiple airports.
// Key = accent-stripped lower-case city name.
// Value = the IATA code that should WIN when there are multiple options.
// This is data-driven (sourced from airport.csv analysis), not guesswork.
// ---------------------------------------------------------------------------
const PREFERRED_IATA = {
  // France
  'paris':          'CDG',
  // UK
  'london':         'LHR',
  // Italy
  'rome':           'FCO',
  'milan':          'MXP',
  // USA
  'new york':       'JFK',
  'chicago':        'ORD',
  'los angeles':    'LAX',
  'miami':          'MIA',
  'houston':        'IAH',
  'dallas':         'DFW',
  'washington':     'IAD',
  'san francisco':  'SFO',
  'boston':         'BOS',
  'atlanta':        'ATL',
  'seattle':        'SEA',
  'denver':         'DEN',
  'minneapolis':    'MSP',
  'detroit':        'DTW',
  'phoenix':        'PHX',
  'orlando':        'MCO',
  'charlotte':      'CLT',
  'honolulu':       'HNL',
  // Japan
  'tokyo':          'NRT',
  'osaka':          'KIX',
  // South Korea
  'seoul':          'ICN',
  // Brazil
  'sao paulo':      'GRU',
  // Middle East / Turkey
  'dubai':          'DXB',
  'istanbul':       'IST',
  // Europe extras
  'brussels':       'BRU',
  'glasgow':        'GLA',
  'warsaw':         'WAW',
  'zurich':         'ZRH',
  // Asia extras
  'bangkok':        'BKK',
  // Australia
  'sydney':         'SYD',
  'melbourne':      'MEL',
};

// ---------------------------------------------------------------------------
// Country-priority list for disambiguation
// When two airports share the same normalised city name but different countries,
// prefer the one whose country appears earlier in this list.
// ---------------------------------------------------------------------------
const COUNTRY_PRIORITY = [
  // Europe first
  'GB','FR','ES','DE','IT','NL','BE','PT','GR','AT','CH','SE','NO','DK','FI',
  'PL','CZ','HU','RO','BG','HR','RS','TR','IE','SK','SI','EE','LV','LT',
  // Asia
  'JP','SG','HK','TH','MY','KR','CN','IN','AE','QA','SA','IL',
  // Americas
  'US','CA','MX','BR','AR','CO','PE','CL',
  // Africa / Oceania
  'ZA','KE','EG','MA','NG','GH','AU','NZ',
];

function countryRank(iso) {
  const idx = COUNTRY_PRIORITY.indexOf(iso);
  return idx === -1 ? 999 : idx;
}

// ---------------------------------------------------------------------------
// Resolve canonical city name for a municipality string
// ---------------------------------------------------------------------------
function resolveCity(municipality, airportName, iataCode, countryCode) {
  if (!municipality) return null;

  const stripped = stripAccents(municipality);

  // Direct exact match
  if (MUNICIPALITY_ALIAS[stripped]) return MUNICIPALITY_ALIAS[stripped];

  // Prefix / substring match (handles "Paris (Roissy..." → matches "paris (roissy-en-france")
  for (const [key, val] of Object.entries(MUNICIPALITY_ALIAS)) {
    if (stripped.startsWith(key)) return val;
  }

  // Airport name contains city hint (e.g. "Milan Malpensa" → "Milan")
  const airportLower = stripAccents(airportName);
  for (const [key, val] of Object.entries(MUNICIPALITY_ALIAS)) {
    if (airportLower.startsWith(key + ' ') || airportLower === key) return val;
  }

  // Fallback: use municipality as-is (title-cased)
  return municipality.trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const SRC  = path.join(__dirname, 'airport.csv');
const DEST = path.join(__dirname, 'airports_lookup.csv');

const raw  = fs.readFileSync(SRC, 'utf8');
const rows = parseCSV(raw);

if (!rows.length) { console.error('Empty CSV'); process.exit(1); }

const header   = rows[0];
const dataRows = rows.slice(1).filter(r => r.length > 13);

// Map header → column index
const col = {};
header.forEach((h, i) => { col[h.trim()] = i; });

const required = ['iata_code','name','municipality','iso_country','continent','type','latitude_deg','longitude_deg','scheduled_service'];
for (const r of required) {
  if (col[r] === undefined) { console.error('Missing column:', r); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Build records — filter inline (replaces the old clean.py step)
// ---------------------------------------------------------------------------
const records = [];

for (const row of dataRows) {
  const iata     = (row[col['iata_code']] || '').trim();
  const name     = (row[col['name']]      || '').trim();
  const muni     = (row[col['municipality']] || '').trim();
  const country  = (row[col['iso_country']] || '').trim();
  const continent= (row[col['continent']]  || '').trim();
  const type     = (row[col['type']]       || '').trim();
  const lat      = (row[col['latitude_deg']]  || '').trim();
  const lon      = (row[col['longitude_deg']] || '').trim();
  const sched    = (row[col['scheduled_service']] || '').trim();

  // Filter: scheduled service only, large or medium airports, valid 3-letter IATA
  if (sched !== 'yes') continue;
  if (!['large_airport', 'medium_airport'].includes(type)) continue;
  if (!iata || iata.length !== 3) continue;
  if (isNonAirport(name))         continue;

  const city     = resolveCity(muni, name, iata, country);
  if (!city)      continue;
  const cityNorm = stripAccents(city);

  records.push({ iata, name, city, cityNorm, country, continent, type, lat, lon });
}

// ---------------------------------------------------------------------------
// Deduplicate: when the same city has multiple airports, apply these rules
// in order:
//   1. If PREFERRED_IATA says which airport to use — use it directly.
//   2. For same city, different countries — prefer by COUNTRY_PRIORITY.
//   3. Same city, same country — large > medium, then longest name
//      (longer official names tend to be the real international airport,
//       e.g. "Charles de Gaulle International" beats "Le Bourget").
// ---------------------------------------------------------------------------
const typePriority = { large_airport: 0, medium_airport: 1 };

// Group by cityNorm → pick best per (city, country), then best country
const cityMap = new Map(); // cityNorm → best record

for (const rec of records) {
  const key = rec.cityNorm;

  // Rule 1: preferred IATA wins unconditionally
  if (PREFERRED_IATA[key] === rec.iata) {
    cityMap.set(key, rec);
    continue;
  }
  if (!cityMap.has(key)) {
    cityMap.set(key, rec);
    continue;
  }
  const existing = cityMap.get(key);

  // Don't displace a preferred airport
  if (PREFERRED_IATA[key] === existing.iata) continue;

  // Rule 2: same city, different country → prefer by country rank
  if (rec.country !== existing.country) {
    const recRank = countryRank(rec.country);
    const exRank  = countryRank(existing.country);
    if (recRank < exRank) { cityMap.set(key, rec); }
    continue;
  }

  // Rule 3: same city, same country → prefer large over medium, then longest name
  const recType = typePriority[rec.type]      ?? 2;
  const exType  = typePriority[existing.type] ?? 2;
  if (recType < exType || (recType === exType && rec.name.length > existing.name.length)) {
    cityMap.set(key, rec);
  }
}

const output = Array.from(cityMap.values());
output.sort((a, b) => a.cityNorm.localeCompare(b.cityNorm));

// ---------------------------------------------------------------------------
// Write output CSV
// ---------------------------------------------------------------------------
const outHeader = 'iata,name,city,city_norm,country,continent,type,lat,lon';

function csvEscape(v) {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

const outLines = [outHeader];
for (const r of output) {
  outLines.push([r.iata, r.name, r.city, r.cityNorm, r.country, r.continent, r.type, r.lat, r.lon].map(csvEscape).join(','));
}

fs.writeFileSync(DEST, outLines.join('\n'), 'utf8');
console.log(`\n✓ Written ${output.length} airports to airports_lookup.csv\n`);

// ---------------------------------------------------------------------------
// Spot-check key airports
// ---------------------------------------------------------------------------
const checks = [
  { query: 'paris',       expect: 'CDG' },
  { query: 'madrid',      expect: 'MAD' },
  { query: 'rome',        expect: 'FCO' },
  { query: 'milan',       expect: 'MXP' },
  { query: 'amsterdam',   expect: 'AMS' },
  { query: 'tokyo',       expect: 'NRT' },
  { query: 'barcelona',   expect: 'BCN' },
  { query: 'lisbon',      expect: 'LIS' },
  { query: 'budapest',    expect: 'BUD' },
  { query: 'frankfurt',   expect: 'FRA' },
  { query: 'sao paulo',   expect: 'GRU' },
  { query: 'athens',      expect: 'ATH' },
  { query: 'london',      expect: 'LHR' },
  { query: 'new york',    expect: 'JFK' },
  { query: 'dubai',       expect: 'DXB' },
  { query: 'singapore',   expect: 'SIN' },
  { query: 'istanbul',    expect: 'IST' },
  { query: 'seoul',       expect: 'ICN' },
  { query: 'vienna',      expect: 'VIE' },
  { query: 'prague',      expect: 'PRG' },
];

console.log('Spot-checks:');
let pass = 0, fail = 0;
for (const { query, expect } of checks) {
  const found = output.find(r => r.cityNorm === query);
  const got   = found ? found.iata : 'NOT FOUND';
  const ok    = got === expect;
  console.log(`  ${ok ? '✓' : '✗'} ${query.padEnd(15)} → ${got.padEnd(5)} ${ok ? '' : `(expected ${expect})`}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${checks.length} checks passed${fail ? ` — ${fail} FAILED` : ''}\n`);
