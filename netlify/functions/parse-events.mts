import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { parseOneClubWithGemini } from '../../src/lib/gemini.mjs';
import { filterValidEvents, deduplicateEvents } from '../../src/lib/schema.mjs';

/**
 * Function B: Read raw scraped content from Blobs, parse with Gemini one club at a time,
 * validate, and store final events JSON.
 * Runs at 03:05 UTC daily (after scrape-events).
 */
export default async function handler() {
  const startTime = Date.now();
  console.log(`[parse-events] Starting at ${new Date().toISOString()}`);

  try {
    // 1. Read raw content from Blobs
    const rawStore = getStore('raw-content');
    const rawData = await rawStore.get('current', { type: 'json' }) as any;

    if (!rawData || !rawData.results || rawData.results.length === 0) {
      console.warn('[parse-events] No raw content found. Run scrape-events first.');
      return new Response(JSON.stringify({
        status: 'no_content',
        message: 'No raw content available. Scraper has not run yet.',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[parse-events] Found raw content from ${rawData.results.length} clubs, scraped at ${rawData.scraped_at}`);

    // 2. Check Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[parse-events] GEMINI_API_KEY not set');
      return new Response(JSON.stringify({ status: 'error', message: 'Missing API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse each club separately with Gemini
    const allEvents: any[] = [];
    const clubResults: any[] = [];

    for (const club of rawData.results) {
      console.log(`[parse-events] Parsing ${club.clubId} (${club.chars} chars)...`);

      try {
        const result = await parseOneClubWithGemini(club, apiKey);

        clubResults.push({
          club: club.clubId,
          events_found: result.events.length,
          error: result.error,
        });

        if (result.events.length > 0) {
          allEvents.push(...result.events);
        }

        // Longer delay between Gemini calls to respect free-tier rate limits
        // Free tier: 20 requests/day, so we space them out generously
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[parse-events] Failed to parse ${club.clubId}: ${message}`);
        clubResults.push({ club: club.clubId, events_found: 0, error: message });
      }
    }

    console.log(`[parse-events] Total raw events from Gemini: ${allEvents.length}`);

    // 4. Validate and deduplicate
    const validEvents = filterValidEvents(allEvents);
    const events = deduplicateEvents(validEvents);
    console.log(`[parse-events] ${events.length} valid unique events (${allEvents.length - events.length} filtered/deduped)`);

    // 5. Store final events to Blobs
    const parsedAt = new Date().toISOString();
    const eventsStore = getStore('events');
    await eventsStore.setJSON('current', {
      events,
      updated_at: parsedAt,
      scraped_at: rawData.scraped_at,
      clubs_parsed: rawData.results.length,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[parse-events] Done in ${elapsed}ms. Stored ${events.length} events.`);

    return new Response(JSON.stringify({
      status: 'ok',
      events_count: events.length,
      clubs_parsed: rawData.results.length,
      club_results: clubResults,
      elapsed_ms: elapsed,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parse-events] Fatal error: ${message}`);
    return new Response(JSON.stringify({ status: 'error', message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Schedule: daily at 03:05 UTC (5 minutes after scrape-events)
export const config: Config = {
  schedule: '5 3 * * *',
};
