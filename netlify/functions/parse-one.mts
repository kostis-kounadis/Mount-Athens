import { getStore } from '@netlify/blobs';
import { parseOneClubWithGemini } from '../../src/lib/gemini.mjs';
import { filterValidEvents } from '../../src/lib/schema.mjs';
import { scrapeClub } from '../../src/lib/scraper.mjs';
import { clubs } from '../../src/config/clubs.mjs';

/**
 * Parse a SINGLE club's events with Gemini.
 * 
 * Usage: GET /api/parse-one?club=poa
 * 
 * This scrapes the club fresh AND parses with Gemini in one call,
 * so you only need one API request per club. Results are merged
 * into the existing events store.
 * 
 * Valid club IDs: eos-acharnon, poa, aos, epos-filis, eosh
 */
export default async function handler(request: Request) {
  const url = new URL(request.url);
  const clubId = url.searchParams.get('club');

  if (!clubId) {
    return new Response(JSON.stringify({
      error: 'Missing ?club= parameter',
      valid_clubs: clubs.map((c: any) => c.id),
      usage: '/api/parse-one?club=poa',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const club = clubs.find((c: any) => c.id === clubId) as any;
  if (!club) {
    return new Response(JSON.stringify({
      error: `Unknown club: ${clubId}`,
      valid_clubs: clubs.map((c: any) => c.id),
    }), {
      status: 400,
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

  console.log(`[parse-one] Processing single club: ${clubId}`);
  const startTime = Date.now();

  try {
    // 1. Scrape this one club fresh
    console.log(`[parse-one] Scraping ${club.name_en}...`);
    const scrapeResult = await scrapeClub(club) as any;

    if (!scrapeResult.content || scrapeResult.content.length < 30) {
      return new Response(JSON.stringify({
        status: 'no_content',
        club: clubId,
        content_length: scrapeResult.content?.length || 0,
        message: `Too little content scraped from ${club.name_en} (${scrapeResult.content?.length || 0} chars). The club website may not have event content at the configured URL.`,
        url_tried: `${club.url}${club.events_path}`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[parse-one] Scraped ${scrapeResult.content.length} chars from ${club.name_en}`);

    // 2. Parse with Gemini (includes retry logic for 429)
    console.log(`[parse-one] Sending to Gemini...`);
    const parseResult = await parseOneClubWithGemini({
      clubId: club.id,
      clubName: club.name_en,
      content: scrapeResult.content,
      url: scrapeResult.url,
    }, apiKey);

    // 3. Validate events
    const validEvents = filterValidEvents(parseResult.events);

    // 4. Merge into existing events store
    const eventsStore = getStore('events');
    let existingData: any = null;
    try {
      existingData = await eventsStore.get('current', { type: 'json' });
    } catch (_) {
      // No existing data
    }

    const existingEvents = existingData?.events || [];
    // Remove old events from this club, add new ones
    const otherClubEvents = existingEvents.filter((e: any) => e.club_id !== clubId);
    const mergedEvents = [...otherClubEvents, ...validEvents];

    const now = new Date().toISOString();
    await eventsStore.setJSON('current', {
      events: mergedEvents,
      updated_at: now,
      last_club_parsed: clubId,
    });

    const elapsed = Date.now() - startTime;

    return new Response(JSON.stringify({
      status: 'ok',
      club: clubId,
      club_name: club.name_en,
      content_scraped_chars: scrapeResult.content.length,
      events_from_gemini: parseResult.events.length,
      events_valid: validEvents.length,
      total_events_in_store: mergedEvents.length,
      gemini_error: parseResult.error,
      elapsed_ms: elapsed,
      content_preview: scrapeResult.content.slice(0, 500) + '...',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parse-one] Error: ${message}`);
    return new Response(JSON.stringify({
      status: 'error',
      club: clubId,
      error: message,
      elapsed_ms: Date.now() - startTime,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
