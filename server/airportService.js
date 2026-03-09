'use strict';

/**
 * airportService.js
 *
 * Loads airports_lookup.csv — the pre-built, normalised airport dataset generated
 * by build_airport_lookup.js.  Each row has a unique canonical city + the best
 * gateway IATA code for that city, with accent-stripped city_norm for fast look-ups.
 *
 * Columns: iata, name, city, city_norm, country, continent, type, lat, lon
 */

const fs   = require('fs');
const path = require('path');

let byCode   = {};   // IATA → record
let byCityNorm = {}; // city_norm → record  (one-to-one after dedup in build step)
let allRecords = [];

// ---------------------------------------------------------------------------
// RFC-4180 CSV parser (no external deps)
// ---------------------------------------------------------------------------
function parseCSV(text) {
  const rows = []; let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if      (ch === '"')  { inQ = true; }
      else if (ch === ',')  { row.push(cur); cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else { cur += ch; }
    }
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Accent / diacritic normalisation — mirrors build_airport_lookup.js
function stripAccents(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Load airports_lookup.csv
// ---------------------------------------------------------------------------
function loadAirports() {
  const csvPath = path.join(__dirname, '..', 'airports_lookup.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('[airportService] airports_lookup.csv not found — run: node build_airport_lookup.js');
    process.exit(1);
  }

  const raw  = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(raw);
  if (rows.length < 2) { console.error('[airportService] airports_lookup.csv is empty'); return; }

  const header = rows[0];
  const col    = {};
  header.forEach((h, i) => { col[h.trim()] = i; });

  const required = ['iata','name','city','city_norm','country','continent','type','lat','lon'];
  for (const r of required) {
    if (col[r] === undefined) { console.error('[airportService] Missing column:', r); process.exit(1); }
  }

  for (const row of rows.slice(1)) {
    if (row.length < required.length) continue;
    const record = {
      iata:      (row[col['iata']]      || '').trim(),
      name:      (row[col['name']]      || '').trim(),
      city:      (row[col['city']]      || '').trim(),
      cityNorm:  (row[col['city_norm']] || '').trim(),
      country:   (row[col['country']]   || '').trim(),
      continent: (row[col['continent']] || '').trim(),
      type:      (row[col['type']]      || '').trim(),
      lat:       parseFloat(row[col['lat']]) || 0,
      lon:       parseFloat(row[col['lon']]) || 0,
    };
    if (!record.iata || record.iata.length !== 3) continue;
    byCode[record.iata]          = record;
    byCityNorm[record.cityNorm]  = record;
    allRecords.push(record);
  }

  console.log(`[airportService] Loaded ${allRecords.length} airports from airports_lookup.csv`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up an airport by its IATA code. */
function getByCode(code) {
  if (!code) return null;
  return byCode[code.toUpperCase().trim()] || null;
}

/**
 * Resolve a user-typed city name to its primary IATA code.
 * Tries:
 *   1. Exact accent-normalised match against city_norm
 *   2. Prefix match (e.g. "Barcelo" → Barcelona)
 *   3. Substring match as final fallback
 */
function getPrimaryCodeForCity(cityInput) {
  if (!cityInput) return null;
  const norm = stripAccents(cityInput);

  // 1. Exact match
  if (byCityNorm[norm]) return byCityNorm[norm].iata;

  // 2. Prefix match
  const prefix = allRecords.find(r => r.cityNorm.startsWith(norm) || norm.startsWith(r.cityNorm));
  if (prefix) return prefix.iata;

  // 3. Substring
  const sub = allRecords.find(r => r.cityNorm.includes(norm) || norm.includes(r.cityNorm));
  if (sub) return sub.iata;

  return null;
}

/**
 * Returns all records whose city_norm matches the given city string.
 * Since the lookup CSV is deduplicated to one record per city, this returns
 * an array of 0 or 1 items — kept as array for backward compatibility.
 */
function getByCity(city) {
  if (!city) return [];
  const norm = stripAccents(city);
  const rec  = byCityNorm[norm];
  return rec ? [rec] : [];
}

/**
 * Full-text search across city, name, iata, country — used by legacy code.
 * Returns up to 10 matches.
 */
function searchAirports(query) {
  const q = stripAccents(query);
  return allRecords.filter(r =>
    r.cityNorm.includes(q) ||
    r.iata.toLowerCase().includes(q) ||
    stripAccents(r.name).includes(q) ||
    r.country.toLowerCase().includes(q)
  ).slice(0, 10);
}

/**
 * Returns unique cities whose normalised name STARTS WITH the query.
 * Used by the /battle autocomplete ("bu" → Budapest, Bucharest …).
 * Returns objects: { city, country, code }
 */
function getCitiesStartingWith(query) {
  const prefix = stripAccents(query);
  if (!prefix) return [];
  const results = [];
  for (const r of allRecords) {
    if (r.cityNorm.startsWith(prefix)) {
      results.push({ city: r.city, country: r.country, code: r.iata });
    }
    if (results.length >= 8) break;
  }
  return results;
}

loadAirports();

module.exports = { getByCode, getByCity, getPrimaryCodeForCity, searchAirports, getCitiesStartingWith };
