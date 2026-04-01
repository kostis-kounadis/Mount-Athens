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

    // Debug: content lengths per club
    const contentLengths = (scrapeResults as any[]).map((r: any) => ({
      club: r.clubId,
      chars: r.content.length,
      preview: r.content.slice(0, 200),
    }));
    console.log(`[scrape-events] Content lengths: ${JSON.stringify(contentLengths.map(c => `${c.club}:${c.chars}`))}`);

    const geminiResult = await parseEventsWithGemini(scrapeResults, apiKey) as any;
    const rawEvents = geminiResult.events || [];
    const geminiError = geminiResult.error;
    const geminiRawResponse = geminiResult.rawResponse;
    console.log(`[scrape-events] Gemini returned ${rawEvents.length} raw events, error: ${geminiError}`);

    // Debug: log first raw event to see what Gemini returns
    if (rawEvents.length > 0) {
      console.log(`[scrape-events] Sample raw event: ${JSON.stringify(rawEvents[0])}`);
    }

    // 4. Validate and deduplicate
    const validEvents = filterValidEvents(rawEvents);
    console.log(`[scrape-events] ${validEvents.length} valid events after filtering (${rawEvents.length - validEvents.length} rejected)`);
    const events = deduplicateEvents(validEvents);
    console.log(`[scrape-events] ${events.length} unique events after dedup`);

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
      debug: {
        content_lengths: contentLengths.map(c => ({ club: c.club, chars: c.chars })),
        gemini_raw_count: rawEvents.length,
        gemini_error: geminiError,
        gemini_raw_response: geminiRawResponse,
        valid_count: validEvents.length,
        sample_raw_event: rawEvents.length > 0 ? rawEvents[0] : null,
      },
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
