# Mount Athens

Event aggregator for Athens mountaineering clubs. A scheduled Netlify function scrapes five club websites daily, sends the raw Greek HTML to Google Gemini for structured extraction, and stores the result as JSON. The frontend is plain HTML + Tailwind CDN with zero build step.

## Clubs

| Club | Website |
|------|---------|
| EOS Acharnon | https://eosacharnon.gr |
| POA (Panhellenic Mountaineering Association) | https://poa.gr |
| AOS (Athens Mountaineering Society) | https://aos.gr |
| EPOS Filis | https://eposfilis.gr |
| EOSH (Mountaineering Club of Athens) | https://eosh.gr/wp |

## Architecture

- **Scheduled Function** (`scrape-events.mts`): Runs daily at 03:00 UTC, scrapes club websites, uses Gemini to parse Greek text into structured JSON, stores in Netlify Blobs
- **API Function** (`events.mts`): Reads events from Netlify Blobs and returns JSON
- **Frontend** (`public/`): Static HTML + Tailwind CDN, fetches `/api/events` and renders a vertical calendar

## Local Development

```bash
npm install
# Set GEMINI_API_KEY in .env or Netlify dashboard
netlify dev
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google AI Studio API key for Gemini calls |

## Deployment

Connect this repo to Netlify via GitHub integration. Set `GEMINI_API_KEY` in the Netlify dashboard environment variables.
