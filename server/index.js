const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is not defined in .env file');
  process.exit(1);
}

// Ensure password is properly encoded in connection string
const mongoURI = process.env.MONGO_URI.replace(
  /:([^/]+)@/,
  (match, p1) => `:${encodeURIComponent(p1)}@`
);

console.log('Attempting to connect to MongoDB...');
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error details:', {
      message: err.message,
      code: err.code,
      codeName: err.codeName,
      errorResponse: err.errorResponse
    });
    process.exit(1);
  });

// Handle MongoDB connection errors
mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Import routes
const validateAirportRoutes = require('./routes/validateAirport');
app.use('/api', validateAirportRoutes);

// Skyscanner API route
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

// Group code generation
const generatedCodes = new Set();

async function generateUniqueCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const UserInput = require('./models/UserInput');
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = Array.from({ length: 8 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    try {
      // Check if code exists in MongoDB
      const existingCode = await UserInput.findOne({ groupCode: code });
      
      if (!existingCode && !generatedCodes.has(code)) {
        generatedCodes.add(code);
        return code;
      }
    } catch (err) {
      console.error('Error checking code uniqueness:', err);
      // If there's an error checking MongoDB, fall back to local Set only
      if (!generatedCodes.has(code)) {
        generatedCodes.add(code);
        return code;
      }
    }
    
    attempts++;
  }

  throw new Error('Failed to generate a unique code after multiple attempts');
}

app.get('/api/generate-group-code', async (req, res) => {
  try {
    const code = await generateUniqueCode();
    res.json({ code });
  } catch (error) {
    console.error('Error generating group code:', error);
    res.status(500).json({ error: 'Failed to generate group code' });
  }
});

// Form submission route
app.post('/api/submit-form', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      throw new Error('MongoDB connection is not ready');
    }

    const UserInput = require('./models/UserInput');
    const newUserInput = new UserInput({
      ...req.body,
      departureDate: new Date(req.body.departureDate),
      returnDate: new Date(req.body.returnDate)
    });

    await newUserInput.save();
    res.status(201).json({ message: 'Form data saved successfully', data: newUserInput });
  } catch (err) {
    console.error('Error saving form data:', err);
    res.status(500).json({ 
      error: 'Failed to save form data', 
      details: err.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
