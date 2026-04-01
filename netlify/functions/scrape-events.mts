import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { getTodaysClub, clubs } from '../../src/config/clubs.mjs';
import { scrapeClub } from '../../src/lib/scraper.mjs';
import { parseOneClubWithGemini } from '../../src/lib/gemini.mjs';
import { parseTribeEventsDirectly } from '../../src/lib/tribe-parser.mjs';
import { filterValidEvents, deduplicateEvents } from '../../src/lib/schema.mjs';
import { fetchURL } from '../../src/lib/scraper.mjs';

/**
 * Daily scheduled function: scrape and parse ONE club per day on rotation.
 *
 * Schedule:
 *   Mon = POA (Gemini)
 *   Tue = AOS (Gemini)
 *   Wed = EPOS Filis (direct Tribe API parse -- no AI)
 *   Thu = EOS Acharnon (Gemini, with Tribe API fallback)
 *   Fri = EOSH (Gemini)
 *   Sat/Sun = rest
 *
 * This keeps Gemini usage to max 1 call/day (well within 20/day free tier).
 * Events accumulate in Blobs -- each club's events persist until its next rotation day.
 */
export default async function handler(request: Request, context: Context) {
  const startTime = Date.now();
  const todaysClub = getTodaysClub() as any;

  if (!todaysClub) {
    console.log('[scrape-events] Weekend -- no club scheduled today.');
    return new Response(JSON.stringify({
      status: 'rest_day',
      message: 'No club scheduled on weekends',
      day: new Date().toUTCString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`[scrape-events] Today's club: ${todaysClub.id} (${todaysClub.name_en})`);

  try {
    let newEvents: any[] = [];
    let parseMethod = '';
    let scrapeInfo: any = {};

    if (todaysClub.source_type === 'tribe_api') {
      // Direct JSON parse -- no Gemini needed
      parseMethod = 'tribe_api_direct';
      const url = `${todaysClub.url}${todaysClub.events_path}`;
      console.log(`[scrape-events] Fetching Tribe API: ${url}`);
      const jsonStr = await fetchURL(url);
      newEvents = parseTribeEventsDirectly(jsonStr, todaysClub);
      scrapeInfo = { url, chars: jsonStr.length };
    } else {
      // HTML scrape + Gemini parse
      parseMethod = 'html_gemini';

      // Try Tribe API fallback first (if configured)
      if (todaysClub.tribe_api_fallback) {
        try {
          const tribeUrl = `${todaysClub.url}${todaysClub.tribe_api_fallback}`;
          console.log(`[scrape-events] Trying Tribe API fallback for ${todaysClub.id}: ${tribeUrl}`);
          const jsonStr = await fetchURL(tribeUrl);
          const tribeEvents = parseTribeEventsDirectly(jsonStr, todaysClub);
          if (tribeEvents.length > 0) {
            console.log(`[scrape-events] Tribe API fallback found ${tribeEvents.length} events for ${todaysClub.id}`);
            newEvents = tribeEvents;
            parseMethod = 'tribe_api_fallback';
            scrapeInfo = { url: tribeUrl, chars: jsonStr.length };
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[scrape-events] Tribe API fallback failed for ${todaysClub.id}: ${msg} (will try HTML+Gemini)`);
        }
      }

      // If Tribe fallback didn't work, use HTML scrape + Gemini
      if (newEvents.length === 0) {
        const scrapeResult = await scrapeClub(todaysClub) as any;
        scrapeInfo = { url: scrapeResult.url, chars: scrapeResult.content?.length || 0 };

        if (!scrapeResult.content || scrapeResult.content.length < 30) {
          console.warn(`[scrape-events] Too little content from ${todaysClub.id} (${scrapeResult.content?.length || 0} chars)`);
        } else {
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ status: 'error', message: 'GEMINI_API_KEY not set' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const parseResult = await parseOneClubWithGemini({
            clubId: todaysClub.id,
            clubName: todaysClub.name_en,
            content: scrapeResult.content,
            url: scrapeResult.url,
          }, apiKey);

          newEvents = parseResult.events;
          if (parseResult.error) {
            scrapeInfo.gemini_error = parseResult.error;
          }
        }
      }
    }

    // Validate new events
    const validNewEvents = filterValidEvents(newEvents);
    console.log(`[scrape-events] ${validNewEvents.length} valid events for ${todaysClub.id}`);

    // Merge into existing events store (replace this club's events, keep others)
    const eventsStore = getStore('events');
    let existingData: any = null;
    try {
      existingData = await eventsStore.get('current', { type: 'json' });
    } catch {
      // No existing data
    }

    const existingEvents: any[] = existingData?.events || [];
    const otherClubEvents = existingEvents.filter((e: any) => e.club_id !== todaysClub.id);
    const mergedEvents = deduplicateEvents([...otherClubEvents, ...validNewEvents]);

    const now = new Date().toISOString();
    await eventsStore.setJSON('current', {
      events: mergedEvents,
      updated_at: now,
      last_club_parsed: todaysClub.id,
      last_parse_method: parseMethod,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[scrape-events] Done in ${elapsed}ms. ${todaysClub.id}: ${validNewEvents.length} events. Total in store: ${mergedEvents.length}`);

    return new Response(JSON.stringify({
      status: 'ok',
      club: todaysClub.id,
      club_name: todaysClub.name_en,
      parse_method: parseMethod,
      events_found: validNewEvents.length,
      total_events_in_store: mergedEvents.length,
      scrape_info: scrapeInfo,
      elapsed_ms: elapsed,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scrape-events] Fatal error: ${message}`);
    return new Response(JSON.stringify({ status: 'error', club: todaysClub.id, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Daily at 03:00 UTC (06:00 Athens time)
export const config: Config = {
  schedule: '0 3 * * *',
};
