import * as cheerio from 'cheerio';
import { clubs as clubsConfig } from '../config/clubs.mjs';

/**
 * Load club configurations.
 * @returns {Promise<object[]>}
 */
export async function loadClubs() {
  return clubsConfig;
}

/**
 * Fetch HTML from a URL with a proper User-Agent and UTF-8 handling.
 *
 * @param {string} url - Full URL to fetch.
 * @param {number} timeoutMs - Timeout in milliseconds (default 15s).
 * @returns {Promise<string>} - The response body as a string.
 */
export async function fetchURL(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MountAthensBot/1.0 (+https://github.com/kostis-kounadis/Mount-Athens)',
        'Accept': 'text/html,application/xhtml+xml,application/json',
        'Accept-Language': 'el,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract text content from HTML using cheerio and a CSS selector.
 * Falls back to extracting from <body> if the selector doesn't match.
 *
 * @param {string} html - Raw HTML string.
 * @param {string} selector - CSS selector(s) to target content areas.
 * @returns {string} - Extracted text content, cleaned up.
 */
export function extractContent(html, selector) {
  const $ = cheerio.load(html);

  // Remove script, style, nav, footer, header elements to reduce noise
  $('script, style, nav, footer, header, .sidebar, .menu, .navigation, .widget').remove();

  // Try each selector (comma-separated) until we find content
  const selectors = selector.split(',').map(s => s.trim());
  let text = '';

  for (const sel of selectors) {
    const elements = $(sel);
    if (elements.length > 0) {
      text = elements.text();
      if (text.trim().length > 100) break; // found substantial content
    }
  }

  // Fallback to body if no selector matched
  if (!text.trim() || text.trim().length < 100) {
    text = $('body').text();
  }

  // Clean up whitespace: collapse multiple spaces/newlines
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 15000); // Cap at 15k chars per club
}

/**
 * Format Tribe Events API JSON response into text for Gemini parsing.
 *
 * @param {string} jsonStr - Raw JSON response from Tribe Events API.
 * @returns {string} - Formatted text with event details.
 */
export function formatTribeEvents(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    const events = data.events || [];

    if (events.length === 0) return '';

    return events.slice(0, 10).map(event => {
      const $ = cheerio.load(event.description || '');
      const descText = $.text().replace(/\s+/g, ' ').trim();

      const parts = [
        `Title: ${event.title}`,
        `Start: ${event.start_date || ''}`,
        `End: ${event.end_date || ''}`,
        `URL: ${event.url || ''}`,
      ];

      if (event.venue) {
        parts.push(`Venue: ${event.venue.venue || ''} ${event.venue.address || ''} ${event.venue.city || ''}`);
      }

      if (descText) {
        parts.push(`Description: ${descText.slice(0, 2000)}`);
      }

      return parts.join('\n');
    }).join('\n---\n');
  } catch (err) {
    console.error(`Failed to parse Tribe API response: ${err.message}`);
    return '';
  }
}

/**
 * Scrape events content from a single club.
 *
 * @param {object} club - Club config object from clubs.mjs.
 * @returns {Promise<{clubId: string, clubName: string, content: string, url: string}>}
 */
export async function scrapeClub(club) {
  const url = `${club.url}${club.events_path}`;
  console.log(`Scraping ${club.name_en} from ${url} (${club.source_type})...`);

  try {
    const body = await fetchURL(url);
    let content;

    if (club.source_type === 'tribe_api') {
      content = formatTribeEvents(body);
    } else {
      content = extractContent(body, club.content_selector);
    }

    if (!content || content.length < 30) {
      console.warn(`Very little content extracted from ${club.name_en} (${content.length} chars)`);
    } else {
      console.log(`Extracted ${content.length} chars from ${club.name_en}`);
    }

    return {
      clubId: club.id,
      clubName: club.name_en,
      content,
      url: club.source_type === 'tribe_api' ? club.url : url,
    };
  } catch (err) {
    console.error(`Failed to scrape ${club.name_en}: ${err.message}`);
    return {
      clubId: club.id,
      clubName: club.name_en,
      content: '',
      url,
      error: err.message,
    };
  }
}

/**
 * Scrape all clubs in parallel for speed (Netlify functions have tight timeouts).
 *
 * @param {object[]} clubs - Array of club config objects.
 * @returns {Promise<object[]>} - Array of scrape results.
 */
export async function scrapeAllClubs(clubs) {
  const settled = await Promise.allSettled(
    clubs.map(club => scrapeClub(club))
  );

  return settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(r => r.content.length > 0);
}
