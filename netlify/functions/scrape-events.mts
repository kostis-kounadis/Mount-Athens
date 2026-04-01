import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { scrapeAllClubs, loadClubs } from '../../src/lib/scraper.mjs';
import { parseEventsWithGemini } from '../../src/lib/gemini.mjs';
import { filterValidEvents, deduplicateEvents } from '../../src/lib/schema.mjs';

export default async function handler() {
  const startTime = Date.now();
  console.log(`[scrape-events] Starting at ${new Date().toISOString()}`);

  try {
    // 1. Load club configs
    const clubs = await loadClubs();
    console.log(`[scrape-events] Loaded ${clubs.length} club configs`);

    // 2. Scrape all clubs in parallel
    const scrapeResults = await scrapeAllClubs(clubs);
    console.log(`[scrape-events] Successfully scraped ${scrapeResults.length}/${clubs.length} clubs`);

    if (scrapeResults.length === 0) {
      console.warn('[scrape-events] No content scraped from any club, keeping existing data');
      return new Response(JSON.stringify({ status: 'no_content', clubs_scraped: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse events with Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[scrape-events] GEMINI_API_KEY not set');
      return new Response(JSON.stringify({ status: 'error', message: 'Missing API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawEvents = await parseEventsWithGemini(scrapeResults, apiKey);
    console.log(`[scrape-events] Gemini returned ${rawEvents.length} events`);

    // 4. Validate and deduplicate
    const validEvents = filterValidEvents(rawEvents);
    const events = deduplicateEvents(validEvents);
    console.log(`[scrape-events] ${events.length} valid unique events after filtering`);

    // 5. Add scraped_at timestamp
    const scrapedAt = new Date().toISOString();
    const timestampedEvents = events.map(e => ({
      ...e,
      scraped_at: scrapedAt,
    }));

    // 6. Write to Netlify Blobs
    const store = getStore('events');
    await store.setJSON('current', {
      events: timestampedEvents,
      updated_at: scrapedAt,
      clubs_scraped: scrapeResults.length,
      total_clubs: clubs.length,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[scrape-events] Done in ${elapsed}ms. Stored ${timestampedEvents.length} events.`);

    return new Response(JSON.stringify({
      status: 'ok',
      events_count: timestampedEvents.length,
      clubs_scraped: scrapeResults.length,
      elapsed_ms: elapsed,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scrape-events] Fatal error: ${message}`);
    return new Response(JSON.stringify({ status: 'error', message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Schedule: daily at 03:00 UTC
export const config: Config = {
  schedule: '0 3 * * *',
};
