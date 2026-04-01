import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';

/**
 * Parse a SINGLE club's events on demand.
 *
 * Usage: GET /api/parse-one?club=poa
 *
 * This scrapes the club fresh AND parses it (Gemini for HTML clubs,
 * direct parse for Tribe API clubs). Results are merged into the
 * existing events store.
 *
 * Valid club IDs: eos-acharnon, poa, aos, epos-filis, eosh
 */
export default async function handler(request: Request, context: Context) {
  try {
    // Lazy imports inside handler to avoid top-level initialization crashes
    const { clubs, getClubById } = await import('../../src/config/clubs.mjs');
    const { scrapeClub, fetchURL } = await import('../../src/lib/scraper.mjs');
    const { parseOneClubWithGemini } = await import('../../src/lib/gemini.mjs');
    const { parseTribeEventsDirectly } = await import('../../src/lib/tribe-parser.mjs');
    const { filterValidEvents } = await import('../../src/lib/schema.mjs');

    // Parse query string safely
    let clubId: string | null = null;
    try {
      const url = new URL(request.url);
      clubId = url.searchParams.get('club');
    } catch {
      const rawUrl = request.url || '';
      const qsMatch = rawUrl.match(/[?&]club=([^&]+)/);
      clubId = qsMatch ? decodeURIComponent(qsMatch[1]) : null;
    }

    const validIds = (clubs as any[]).map((c: any) => c.id);

    if (!clubId) {
      return new Response(JSON.stringify({
        error: 'Missing ?club= parameter',
        valid_clubs: validIds,
        usage: '/api/parse-one?club=poa',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const club = getClubById(clubId) as any;
    if (!club) {
      return new Response(JSON.stringify({
        error: `Unknown club: ${clubId}`,
        valid_clubs: validIds,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[parse-one] Processing: ${clubId} (${club.source_type})`);
    const startTime = Date.now();

    let newEvents: any[] = [];
    let parseMethod = '';
    let scrapeInfo: any = {};

    // Tribe API clubs: parse directly, no AI needed
    if (club.source_type === 'tribe_api') {
      parseMethod = 'tribe_api_direct';
      const url = `${club.url}${club.events_path}`;
      console.log(`[parse-one] Fetching Tribe API: ${url}`);
      const jsonStr = await fetchURL(url);
      newEvents = parseTribeEventsDirectly(jsonStr, club);
      scrapeInfo = { url, chars: jsonStr.length };
    } else {
      // HTML clubs: try Tribe API fallback first, then Gemini
      parseMethod = 'html_gemini';

      if (club.tribe_api_fallback) {
        try {
          const tribeUrl = `${club.url}${club.tribe_api_fallback}`;
          const jsonStr = await fetchURL(tribeUrl);
          const tribeEvents = parseTribeEventsDirectly(jsonStr, club);
          if (tribeEvents.length > 0) {
            newEvents = tribeEvents;
            parseMethod = 'tribe_api_fallback';
            scrapeInfo = { url: tribeUrl, chars: jsonStr.length };
          }
        } catch {
          // Tribe fallback not available, continue to Gemini
        }
      }

      if (newEvents.length === 0) {
        const scrapeResult = await scrapeClub(club) as any;
        scrapeInfo = { url: scrapeResult.url, chars: scrapeResult.content?.length || 0 };

        if (!scrapeResult.content || scrapeResult.content.length < 30) {
          return new Response(JSON.stringify({
            status: 'no_content',
            club: clubId,
            content_length: scrapeResult.content?.length || 0,
            message: `Too little content from ${club.name_en}`,
            url_tried: scrapeInfo.url,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const parseResult = await parseOneClubWithGemini({
          clubId: club.id,
          clubName: club.name_en,
          content: scrapeResult.content,
          url: scrapeResult.url,
        }, apiKey);

        newEvents = parseResult.events;
        if (parseResult.error) {
          scrapeInfo.gemini_error = parseResult.error;
        }
      }
    }

    // Validate
    const validEvents = filterValidEvents(newEvents);

    // Merge into existing events store
    const eventsStore = getStore('events');
    let existingData: any = null;
    try {
      existingData = await eventsStore.get('current', { type: 'json' });
    } catch {
      // No existing data
    }

    const existingEvents = existingData?.events || [];
    const otherClubEvents = existingEvents.filter((e: any) => e.club_id !== clubId);
    const mergedEvents = [...otherClubEvents, ...validEvents];

    const now = new Date().toISOString();
    await eventsStore.setJSON('current', {
      events: mergedEvents,
      updated_at: now,
      last_club_parsed: clubId,
      last_parse_method: parseMethod,
    });

    const elapsed = Date.now() - startTime;

    return new Response(JSON.stringify({
      status: 'ok',
      club: clubId,
      club_name: club.name_en,
      parse_method: parseMethod,
      events_found: validEvents.length,
      total_events_in_store: mergedEvents.length,
      scrape_info: scrapeInfo,
      elapsed_ms: elapsed,
      content_preview: scrapeInfo.chars > 0 ? '(available)' : '(empty)',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error(`[parse-one] Fatal error: ${message}\n${stack}`);
    return new Response(JSON.stringify({
      status: 'error',
      error: message,
      stack: stack?.split('\n').slice(0, 5),
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
