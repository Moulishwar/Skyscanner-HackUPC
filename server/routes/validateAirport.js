const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const router = express.Router();
const matchedAirports = [];

function validateAirportOrCity(query) {
  return new Promise((resolve, reject) => {
    const matches = [];
    fs.createReadStream(path.join(__dirname, '..', 'data', 'airports.csv'))
      .pipe(csv({ headers: false }))
      .on('data', (row) => {
        const city = row[2]?.toLowerCase();
        const airportCode = row[4]?.toLowerCase();
        const name = row[1]?.toLowerCase();
        const q = query.toLowerCase();
        if (city?.includes(q) || airportCode === q || name?.includes(q)) {
          matches.push({
            code: row[4],
            name: row[1],
            city: row[2],
            country: row[3]
          });
        }
      })
      .on('end', () => {
        if (matches.length > 0) {
          matchedAirports.push(matches[0]); // Save the first match (simulate DB save)
          resolve(matches[0]);
        } else {
          resolve(null);
        }
      })
      .on('error', reject);
  });
}

router.get('/validate-airport-local', async (req, res) => {
  const { query } = req.query;
  try {
    const result = await validateAirportOrCity(query);
    if (result) {
      res.json({ valid: true, match: result });
    } else {
      res.json({ valid: false });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
