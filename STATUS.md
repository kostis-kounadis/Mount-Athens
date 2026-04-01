# Mount Athens -- Project Status

**Last updated:** 2026-04-01

## Current State: Deployed with daily club rotation

The project is deployed at **https://mountathens.netlify.app/**. The architecture uses a daily club rotation to stay within Gemini free-tier limits.

## Architecture

```
Mon: scrape-events --> POA (HTML scrape + Gemini)
Tue: scrape-events --> AOS (HTML scrape + Gemini)
Wed: scrape-events --> EPOS Filis (Tribe Events API -- direct JSON parse, NO AI)
Thu: scrape-events --> EOS Acharnon (Tribe API fallback, then Gemini)
Fri: scrape-events --> EOSH (HTML scrape + Gemini)
Sat/Sun: rest

Browser --> /api/events --> events.mts --> reads from Netlify Blobs
Manual  --> /api/parse-one?club=X --> scrape + parse single club on demand
```

### Key design choices

- **1 Gemini call/day max** -- daily rotation means we use at most 1 of the 20 free requests
- **EPOS Filis needs ZERO AI** -- their Tribe Events REST API returns structured JSON we parse directly
- **EOS Acharnon tries Tribe API first** -- if available, no AI needed; falls back to Gemini
- **Events accumulate** -- each club's events persist until its next rotation day (5-day refresh cycle)
- **Existing data protected** -- new events merge into the store; empty results don't wipe existing data

### Manual trigger URLs

- **Parse one club:** `https://mountathens.netlify.app/api/parse-one?club=epos-filis` (no AI, always works)
- **View events:** `https://mountathens.netlify.app/api/events`
- **Trigger today's rotation:** `https://mountathens.netlify.app/.netlify/functions/scrape-events`

## What's Done

### Infrastructure
- [x] Repository: `kostis-kounadis/Mount-Athens`
- [x] Deployed to Netlify at https://mountathens.netlify.app/
- [x] `GEMINI_API_KEY` configured in Netlify dashboard
- [x] Daily scheduled function with club rotation

### Backend
- [x] `netlify/functions/scrape-events.mts` -- daily rotation: scrape + parse one club
- [x] `netlify/functions/events.mts` -- API endpoint serving events from Blobs
- [x] `netlify/functions/parse-one.mts` -- manual single-club endpoint (lazy imports to avoid crashes)
- [x] `src/lib/scraper.mjs` -- HTML fetch + cheerio content extraction
- [x] `src/lib/gemini.mjs` -- Gemini 2.0 Flash with short retry (compatible with Netlify timeout)
- [x] `src/lib/tribe-parser.mjs` -- direct Tribe Events API parser (no AI)
- [x] `src/lib/schema.mjs` -- event validation, dedup, difficulty mapping
- [x] `src/config/clubs.mjs` -- 5 clubs with rotation schedule and Tribe API fallbacks

### Frontend
- [x] `public/index.html` -- responsive Tailwind CDN layout
- [x] `public/js/calendar.js` -- vertical calendar with club filters, color coding
- [x] Falls back to sample data when API has no data

### Tests
- [x] 13 passing schema validation tests

## Known Limitations

| Issue | Impact | Status |
|-------|--------|--------|
| EOS Acharnon low content (253 chars) | May not find events from HTML | Tribe API fallback configured |
| EOSH low content (368 chars) | May not find events from HTML | Needs better URL or Tribe API |
| AOS URL has hardcoded year range | Will break when dates change | Needs dynamic URL detection |
| Gemini free tier: 20 req/day | Limits total daily parsing | Solved with rotation + direct parsing |

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Netlify Dashboard | Google AI Studio API key for Gemini 2.0 Flash |
