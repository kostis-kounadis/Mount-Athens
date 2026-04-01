# Mount Athens -- Project Status

**Last updated:** 2026-04-01

## Current State: Deployed, awaiting Gemini API quota reset

The project is fully implemented and deployed at **https://mountathens.netlify.app/**. The site currently displays sample/fallback data because the Gemini API free-tier quota was exhausted during initial testing.

## Architecture: Two-Function Pipeline

The scraping and AI parsing are split into two separate Netlify functions to avoid timeouts and keep each step focused:

```
[Cron 03:00 UTC] --> scrape-events.mts --> Fetches 5 club websites --> Stores raw content to Blobs
                                                                              |
[Cron 03:05 UTC] --> parse-events.mts --> Reads raw content from Blobs        |
                                      --> Calls Gemini per club (5 calls)     |
                                      --> Validates + deduplicates            |
                                      --> Stores final events to Blobs --------+
                                                                              |
[Browser]        --> /api/events      --> events.mts reads from Blobs ---------+
                                      --> Returns JSON to calendar.js
```

### Manual trigger URLs
- **Scrape:** `https://mountathens.netlify.app/.netlify/functions/scrape-events`
- **Parse:** `https://mountathens.netlify.app/.netlify/functions/parse-events` (or `/api/parse`)
- **View events:** `https://mountathens.netlify.app/api/events`

**Workflow:** Visit scrape URL first, wait for it to return, then visit parse URL.

## What's Done

### Infrastructure
- [x] Repository: `kostis-kounadis/Mount-Athens`
- [x] Deployed to Netlify at https://mountathens.netlify.app/
- [x] `GEMINI_API_KEY` configured in Netlify dashboard
- [x] Two scheduled functions: scrape (03:00 UTC) + parse (03:05 UTC)

### Backend (Netlify Functions)
- [x] `netlify/functions/scrape-events.mts` -- fetches club websites, stores raw content to Blobs
- [x] `netlify/functions/parse-events.mts` -- reads raw content, calls Gemini per club, validates, stores events
- [x] `netlify/functions/events.mts` -- API endpoint serving events from Blobs
- [x] `src/lib/scraper.mjs` -- HTML fetch + cheerio extraction + Tribe API support
- [x] `src/lib/gemini.mjs` -- Gemini 2.5 Flash, one-club-at-a-time parsing
- [x] `src/lib/schema.mjs` -- event validation, dedup, difficulty mapping
- [x] `src/config/clubs.mjs` -- 5 club configs with verified URLs

### Frontend
- [x] `public/index.html` -- responsive Tailwind CDN layout
- [x] `public/js/calendar.js` -- vertical calendar with club filters, color coding
- [x] `public/css/custom.css` -- custom styles
- [x] Falls back to `public/data/events-sample.json` when API has no data

### Tests
- [x] 13 passing schema validation tests (node:test)

## What Needs to Happen Next

### 1. Gemini API Quota Reset
The `gemini-2.0-flash` free-tier quota was exhausted during testing. The model has been switched to `gemini-2.5-flash`. Either:
- Wait for the daily quota to reset, OR
- Generate a new API key at https://aistudio.google.com/apikey and update it in Netlify dashboard > Site configuration > Environment variables > `GEMINI_API_KEY`

Then test:
1. Visit `https://mountathens.netlify.app/.netlify/functions/scrape-events` -- should return `{"status":"ok","clubs_scraped":5,...}`
2. Visit `https://mountathens.netlify.app/.netlify/functions/parse-events` -- should return `{"status":"ok","events_count":X,...}`
3. Visit `https://mountathens.netlify.app/` -- should show real events

### 2. Club URL Improvements
| Club | Issue | Suggested Fix |
|------|-------|---------------|
| EOS Acharnon | Root page only 253 chars, subpages return 508 | Check if they have a Tribe Events API like EPOS Filis, or try different subpages |
| EOSH | `/wp/category/events/` only 368 chars | Try `https://eosh.gr/wp/product-category/greek-mountains-climbs/` instead. Update `events_path` in `src/config/clubs.mjs` |
| AOS | URL contains year range that will change | Scrape homepage and follow schedule links dynamically |

### 3. Production Cleanup
- Remove `debug` fields from responses (currently in scrape-events and parse-events for debugging)
- Add retry logic for Gemini 429 rate limit errors
- Consider adding error notification (email or webhook) when scraper fails

### 4. Design Polish
- The frontend uses basic Tailwind. Customize `public/css/custom.css`
- Add club logos to `public/assets/`
- Typography, colors, spacing per designer preference

## Key Files

| File | Purpose |
|------|---------|
| `src/config/clubs.mjs` | Club URLs, selectors, source types |
| `src/lib/scraper.mjs` | HTML fetching and content extraction |
| `src/lib/gemini.mjs` | Gemini API call (per-club), response parsing |
| `src/lib/schema.mjs` | Event validation and deduplication |
| `netlify/functions/scrape-events.mts` | Cron: scrape websites, store raw content |
| `netlify/functions/parse-events.mts` | Cron: parse raw content with Gemini |
| `netlify/functions/events.mts` | API: serve events to frontend |
| `public/js/calendar.js` | Frontend calendar rendering |
| `netlify.toml` | Netlify config, redirects, function dir |

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Netlify Dashboard | Google AI Studio API key for Gemini 2.5 Flash |

## Verified Club URLs (as of 2026-04-01)

| Club | URL | Chars | Notes |
|------|-----|-------|-------|
| EOS Acharnon | https://eosacharnon.gr/ | 253 | Subpages 508, low content |
| POA | https://poa.gr/index.php/programma/ | 15,000 | Works well |
| AOS | https://aos.gr/programma-exormiseon-ianouarios-2026-septemvrios-2026/ | 15,000 | Year-specific URL |
| EPOS Filis | https://eposfilis.gr/wp-json/tribe/events/v1/events | 17,099 | JSON API, works great |
| EOSH | https://eosh.gr/wp/category/events/ | 368 | Low content, needs better URL |
