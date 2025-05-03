const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Import and mount the validateAirport routes
const validateAirportRoutes = require('./routes/validateAirport');
app.use('/api', validateAirportRoutes);

app.get('/api/airports', async (req, res) => {
    const { query } = req.query;
  
    try {
      const response = await axios.get(
        'https://partners.api.skyscanner.net/apiservices/autosuggest/v1.0/IN/INR/en-GB/',
        {
          params: {
            query,
            apiKey: process.env.SKYSCANNER_API_KEY,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
  
      res.json(response.data);
    } catch (error) {
      console.error('Error fetching airport suggestions:', error.message);
      res.status(error.response?.status || 500).json({
        error: error.message,
        data: error.response?.data,
      });
    }
  });
  

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const generatedCodes = new Set();

function generateUniqueCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code;
  do {
    code = Array.from({ length: 8 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');
  } while (generatedCodes.has(code));
  generatedCodes.add(code);
  return code;
}

app.get('/api/generate-group-code', (req, res) => {
  const code = generateUniqueCode();
  res.json({ code });
});
