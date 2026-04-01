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
 * @returns {Promise<string>} - The HTML body as a string.
 */
export async function fetchHTML(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MountAthensBot/1.0 (+https://github.com/kostis-kounadis/Mount-Athens)',
        'Accept': 'text/html,application/xhtml+xml',
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
  $('script, style, nav, footer, header, .sidebar, .menu, .navigation').remove();

  // Try each selector (comma-separated) until we find content
  const selectors = selector.split(',').map(s => s.trim());
  let text = '';

  for (const sel of selectors) {
    const elements = $(sel);
    if (elements.length > 0) {
      text = elements.text();
      break;
    }
  }

  // Fallback to body if no selector matched
  if (!text.trim()) {
    text = $('body').text();
  }

  // Clean up whitespace: collapse multiple spaces/newlines
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 15000); // Cap at 15k chars to stay within Gemini context limits
}

/**
 * Scrape events content from a single club.
 *
 * @param {object} club - Club config object from clubs.json.
 * @returns {Promise<{clubId: string, clubName: string, content: string, url: string}>}
 */
export async function scrapeClub(club) {
  const url = `${club.url}${club.events_path}`;
  console.log(`Scraping ${club.name_en} from ${url}...`);

  try {
    const html = await fetchHTML(url);
    const content = extractContent(html, club.content_selector);

    if (!content || content.length < 50) {
      console.warn(`Very little content extracted from ${club.name_en} (${content.length} chars)`);
    }

    return {
      clubId: club.id,
      clubName: club.name_en,
      content,
      url,
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
 * Scrape all clubs in parallel.
 *
 * @param {object[]} clubs - Array of club config objects.
 * @returns {Promise<object[]>} - Array of scrape results.
 */
export async function scrapeAllClubs(clubs) {
  const results = await Promise.allSettled(
    clubs.map(club => scrapeClub(club))
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(r => r.content.length > 0);
}
