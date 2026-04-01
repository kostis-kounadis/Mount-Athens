# Mount Athens -- Project Status

**Last updated:** 2026-04-01

## Current State: Working but needs first successful Gemini scrape

The project is fully implemented and deployed at **https://mountathens.netlify.app/**. The site currently displays sample/fallback data because the Gemini API scraper has not yet completed a successful run.

## What's Done

### Infrastructure
- [x] Repository created at `kostis-kounadis/Mount-Athens`
- [x] Deployed to Netlify at https://mountathens.netlify.app/
- [x] `GEMINI_API_KEY` environment variable configured in Netlify dashboard
- [x] Daily scheduled function at 03:00 UTC (06:00 Athens time)

### Backend (Netlify Functions)
- [x] `netlify/functions/scrape-events.mts` -- scheduled scraper function
- [x] `netlify/functions/events.mts` -- API endpoint serving events from Netlify Blobs
- [x] `src/lib/scraper.mjs` -- HTML fetch + cheerio extraction + Tribe API support
- [x] `src/lib/gemini.mjs` -- Gemini API integration with Greek-aware prompt
- [x] `src/lib/schema.mjs` -- event validation, dedup, difficulty mapping
- [x] `src/config/clubs.mjs` -- 5 club configs with verified URLs

### Frontend
- [x] `public/index.html` -- responsive Tailwind CDN layout
- [x] `public/js/calendar.js` -- vertical calendar with club filters, color coding
- [x] `public/css/custom.css` -- custom styles
- [x] Falls back to `public/data/events-sample.json` when API has no data

### Tests
- [x] 13 passing schema validation tests (node:test)

## What's Left to Do

### Critical -- Must fix for the scraper to work
1. **Gemini model quota**: Changed to `gemini-2.5-flash`. If the free tier quota is still exhausted, wait for it to reset (resets daily) or create a new Google AI Studio API key from a different project. The Gemini API key is set in Netlify dashboard > Site configuration > Environment variables > `GEMINI_API_KEY`.

2. **Test the scraper**: After quota resets, visit `https://mountathens.netlify.app/.netlify/functions/scrape-events` to trigger a manual scrape. A successful response looks like `{"status":"ok","events_count":15,...}`.

### Nice-to-have improvements
3. **EOS Acharnon (eos-acharnon)**: Their site returns 508 errors on subpages. Currently scraping the homepage which only has 253 chars. May need to investigate alternative URLs or check if they have a Tribe Events API too.

4. **EOSH content**: Only 368 chars extracted from `/wp/category/events/`. Better URL might be `https://eosh.gr/wp/product-category/greek-mountains-climbs/` (as user suggested). Update `events_path` in `src/config/clubs.mjs`.

5. **Remove debug output**: Once the scraper works, remove the `debug` field from the scrape-events response in `netlify/functions/scrape-events.mts`. It currently exposes content lengths, Gemini errors, and raw responses -- useful for debugging but not for production.

6. **AOS URL stability**: The AOS events page URL contains the year range (`ianouarios-2026-septemvrios-2026`). This will break when the new schedule is published. Consider scraping the AOS homepage instead and following links dynamically.

7. **Retry logic**: Add retry with backoff for Gemini API rate limits (429 errors). Currently fails silently.

8. **Design polish**: The frontend uses basic Tailwind. A designer could customize `public/css/custom.css` and add club logos to `public/assets/`.

## Architecture Quick Reference

```
Browser -> /api/events -> Netlify Function (events.mts) -> Netlify Blobs -> JSON response
                                                                    ^
Cron (03:00 UTC) -> scrape-events.mts -> scraper.mjs -> 5 club websites
                                      -> gemini.mjs  -> Gemini 2.5 Flash
                                      -> schema.mjs  -> validate + dedup
                                      -> Netlify Blobs (write)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/config/clubs.mjs` | Club URLs, selectors, source types |
| `src/lib/scraper.mjs` | HTML fetching and content extraction |
| `src/lib/gemini.mjs` | Gemini API call and response parsing |
| `src/lib/schema.mjs` | Event validation and deduplication |
| `netlify/functions/scrape-events.mts` | Scheduled scraper orchestrator |
| `netlify/functions/events.mts` | API endpoint for frontend |
| `public/js/calendar.js` | Frontend calendar rendering |
| `netlify.toml` | Netlify config, redirects |

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Netlify Dashboard | Google AI Studio API key |

## Verified Club URLs (as of 2026-04-01)

| Club | URL | Status |
|------|-----|--------|
| EOS Acharnon | https://eosacharnon.gr/ | 200 (but subpages return 508) |
| POA | https://poa.gr/index.php/programma/ | 200, 15K chars |
| AOS | https://aos.gr/programma-exormiseon-ianouarios-2026-septemvrios-2026/ | 200, 15K chars |
| EPOS Filis | https://eposfilis.gr/wp-json/tribe/events/v1/events | 200, JSON API, 17K chars |
| EOSH | https://eosh.gr/wp/category/events/ | 200, only 368 chars |
