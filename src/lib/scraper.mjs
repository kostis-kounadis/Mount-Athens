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
 * Fetch a URL with a proper User-Agent and timeout.
 *
 * @param {string} url - Full URL to fetch.
 * @param {number} timeoutMs - Timeout in milliseconds (default 10s).
 * @returns {Promise<string>} - The response body as a string.
 */
export async function fetchURL(url, timeoutMs = 10000) {
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
 * Extract text content from HTML using cheerio and CSS selectors.
 * Falls back to <body> if no selector matches enough content.
 *
 * @param {string} html - Raw HTML string.
 * @param {string} selector - Comma-separated CSS selectors.
 * @returns {string} - Extracted text content, cleaned up.
 */
export function extractContent(html, selector) {
  const $ = cheerio.load(html);

  // Remove noise elements
  $('script, style, nav, footer, header, .sidebar, .menu, .navigation, .widget, .comment, .comments').remove();

  // Try each selector until we find substantial content
  const selectors = selector.split(',').map(s => s.trim());
  let text = '';

  for (const sel of selectors) {
    const elements = $(sel);
    if (elements.length > 0) {
      text = elements.text();
      if (text.trim().length > 100) break;
    }
  }

  // Fallback to body
  if (!text.trim() || text.trim().length < 100) {
    text = $('body').text();
  }

  // Clean up whitespace
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 15000); // Cap at 15k chars per club
}

/**
 * Scrape events content from a single club.
 *
 * @param {object} club - Club config object.
 * @returns {Promise<{clubId: string, clubName: string, content: string, url: string}>}
 */
export async function scrapeClub(club) {
  const url = `${club.url}${club.events_path}`;
  console.log(`Scraping ${club.name_en} from ${url} (${club.source_type})...`);

  try {
    const body = await fetchURL(url);
    const content = extractContent(body, club.content_selector);

    if (!content || content.length < 30) {
      console.warn(`Very little content from ${club.name_en} (${content.length} chars)`);
    } else {
      console.log(`Extracted ${content.length} chars from ${club.name_en}`);
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
 * @returns {Promise<object[]>} - Array of scrape results with content.
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
