# Mount Athens

Event aggregator for Athens mountaineering clubs. A scheduled Netlify function scrapes club websites daily (one club per day on rotation), parses Greek event content into structured JSON, and stores results in Netlify Blobs. The frontend is plain HTML + Tailwind CDN with zero build step.

**Live site:** https://mountathens.netlify.app/

## Clubs

| Club | Website | Parse Method | Day |
|------|---------|-------------|-----|
| POA | https://poa.gr | Gemini AI | Monday |
| AOS | https://aos.gr | Gemini AI | Tuesday |
| EPOS Filis | https://eposfilis.gr | Direct Tribe API (no AI) | Wednesday |
| EOS Acharnon | https://eosacharnon.gr | Tribe API fallback, then Gemini | Thursday |
| EOSH | https://eosh.gr/wp | Gemini AI | Friday |

## Architecture

The system uses a **daily club rotation** to stay within Gemini free-tier limits (20 requests/day):

```
Mon: scrape-events --> POA (Gemini)
Tue: scrape-events --> AOS (Gemini)
Wed: scrape-events --> EPOS Filis (direct JSON parse, no AI)
Thu: scrape-events --> EOS Acharnon (Gemini or Tribe API fallback)
Fri: scrape-events --> EOSH (Gemini)
Sat/Sun: rest
```

Each club's events persist in the store until that club's next rotation day. Full refresh cycle: 5 days.

### Functions

| Function | Purpose | Trigger |
|----------|---------|---------|
| `scrape-events` | Scrape + parse today's club | Cron daily 03:00 UTC |
| `events` | Serve events JSON to frontend | `/api/events` |
| `parse-one` | Manual single-club scrape+parse | `/api/parse-one?club=<id>` |

### Key Files

| File | Purpose |
|------|---------|
| `src/config/clubs.mjs` | Club URLs, selectors, rotation schedule |
| `src/lib/scraper.mjs` | HTML fetching and content extraction |
| `src/lib/gemini.mjs` | Gemini API call with structured prompt |
| `src/lib/tribe-parser.mjs` | Direct Tribe Events API JSON parser (no AI) |
| `src/lib/schema.mjs` | Event validation and deduplication |
| `public/js/calendar.js` | Frontend calendar rendering |

## Manual Testing

Test one club at a time by visiting:

```
https://mountathens.netlify.app/api/parse-one?club=epos-filis  (no AI, should always work)
https://mountathens.netlify.app/api/parse-one?club=poa          (uses 1 Gemini call)
https://mountathens.netlify.app/api/parse-one?club=aos          (uses 1 Gemini call)
```

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Netlify Dashboard | Google AI Studio API key for Gemini 2.0 Flash |

## Local Development

```bash
npm install
# Set GEMINI_API_KEY in .env or Netlify dashboard
netlify dev
```
