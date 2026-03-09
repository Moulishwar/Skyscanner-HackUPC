# TravelBattle — Group Trip Planner

> Built at **HackUPC 2025** · Barcelona, Spain · 36-hour hackathon

A Skyscanner-integrated web app that makes deciding on a group holiday actually fun. Friends in different cities propose destinations, real flight prices are fetched live, and an AI judge picks the winner.

---

## The Problem

Planning a group trip is painful. Someone wants Bangkok, someone wants Lisbon, and the WhatsApp thread goes quiet for three days. Nobody agrees, nothing gets booked.

## The Solution

**TravelBattle** turns the argument into a game. Each person joins from their own location with their own budget. They propose destinations, vote, and an AI evaluates the real cost of getting everyone there — then picks the best option for the group.

---

## Features

- **Skyscanner-style UI** — familiar, clean homepage that extends naturally into the Group Trip experience
- **Real-time multiplayer chat** — Socket.io powered room where everyone can talk, propose, and react
- **`/battle` command** — trigger a head-to-head comparison of any destinations (`/battle Lisbon vs Bangkok vs Rome`)
  - Fetches live flight prices from the Amadeus API for every player's origin city
  - Aggregates average cost, duration and distance across all origins
  - 10-second voting window before the AI judge fires
- **`/suggest` command** — ask the AI for personalised destination ideas based on everyone's location and budget (`/suggest warm places with beaches`)
- **AI Judge** — OpenRouter LLM evaluates the flight data and delivers a witty, opinionated verdict
- **New Ideas panel** — when a second player joins, the AI automatically generates a shared travel challenge tailored to the group's origins
- **Leaderboard** — tracks wins across battles in the session
- **Recently Viewed** — sidebar showing the last 4 destinations battled with average price and flight time
- **Flight settings** — each user sets their own departure city and budget; editable mid-session
- **Reconnect grace period** — refreshing the page doesn't spam the room with join/leave messages

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Server | Express |
| Real-time | Socket.io |
| Flight data | Amadeus Flight Offers Search API |
| AI judge | OpenRouter (configurable model via `.env`) |
| HTTP client | Axios |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Data | SQLite (better-sqlite3) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [Amadeus Developer](https://developers.amadeus.com/) account (free tier works)
- An [OpenRouter](https://openrouter.ai/) API key (free models available)

### Installation

```bash
git clone https://github.com/Moulishwar/Skyscanner-HackUPC.git
cd Skyscanner-HackUPC
npm install
```

### Configuration

Create a `.env` file in the project root:

```ini
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_client_secret
OPENROUTER_API_KEY=your_openrouter_api_key
MODEL=your_model
PORT=3000
```

> **Recommended free models:** `arcee-ai/trinity-large-preview:free`, `meta-llama/llama-3.3-70b-instruct:free`

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## How to Play

1. Open two browser tabs (or share the URL with a friend on the same network)
2. Click **Group Trip** in the nav → **Start Battle**
3. Log in as `alice` / `password` in one tab, `bob` / `password` in the other
4. Set your departure city and budget in **Flight Settings**
5. Once both players are in, the AI drops a shared travel challenge
6. Type `/battle Paris vs Tokyo vs Lisbon` to start a fight
7. Vote within 10 seconds, then watch the AI judge deliver its verdict
8. Or type `/suggest beach destinations under £500` for AI-powered ideas
9. Check the leaderboard — most wins takes the crown

---

## Project Structure

```
├── client/
│   ├── index.html          # Skyscanner-style homepage
│   ├── group-trip.html     # TravelBattle landing page
│   ├── login.html          # Login screen
│   ├── chat.html           # Main battle room
│   ├── style.css
│   └── main.js
├── server/
│   ├── server.js           # Express + Socket.io entry point
│   ├── auth.js             # Local session auth (alice / bob)
│   ├── db.js               # SQLite database setup, schema and seed data
│   ├── chat.js             # Socket event handlers
│   ├── gameEngine.js       # Battle logic, leaderboard, flight aggregation
│   ├── amadeusService.js   # Amadeus API integration
│   ├── llmService.js       # OpenRouter LLM integration
│   └── airportService.js   # Airport lookup from CSV
├── airports_lookup.csv     # Cleaned airport data (city → IATA)
├── build_airport_lookup.js # Script to regenerate airports_lookup.csv
└── .env                    # API keys (not committed)
```

---

## Sustainability Angle

Flight duration and distance are factored into the AI's verdict — not just price. The judge is aware of travel time across all players' origins, nudging the group toward destinations that are geographically sensible for everyone rather than just cheap for one person.

---

## Built In

Made in 36 hours at **HackUPC 2025**, Barcelona — Europe's largest student hackathon.
