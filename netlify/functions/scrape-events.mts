import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { scrapeAllClubs, loadClubs } from '../../src/lib/scraper.mjs';

/**
 * Function A: Scrape club websites and store raw content to Netlify Blobs.
 * No Gemini call here -- just fetch and store.
 * Runs at 03:00 UTC daily.
 */
export default async function handler() {
  const startTime = Date.now();
  console.log(`[scrape-events] Starting at ${new Date().toISOString()}`);

  try {
    // 1. Load club configs
    const clubs = await loadClubs() as any[];
    console.log(`[scrape-events] Loaded ${clubs.length} club configs`);

    // 2. Scrape all clubs in parallel
    const scrapeResults = await scrapeAllClubs(clubs) as any[];
    console.log(`[scrape-events] Successfully scraped ${scrapeResults.length}/${clubs.length} clubs`);

    // 3. Store raw content to Blobs
    const scrapedAt = new Date().toISOString();
    const store = getStore('raw-content');
    await store.setJSON('current', {
      scraped_at: scrapedAt,
      clubs_scraped: scrapeResults.length,
      total_clubs: clubs.length,
      results: scrapeResults.map((r: any) => ({
        clubId: r.clubId,
        clubName: r.clubName,
        url: r.url,
        content: r.content,
        chars: r.content.length,
      })),
    });

    const elapsed = Date.now() - startTime;
    console.log(`[scrape-events] Done in ${elapsed}ms. Stored raw content for ${scrapeResults.length} clubs.`);

    return new Response(JSON.stringify({
      status: 'ok',
      clubs_scraped: scrapeResults.length,
      total_clubs: clubs.length,
      content_lengths: scrapeResults.map((r: any) => ({ club: r.clubId, chars: r.content.length })),
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
