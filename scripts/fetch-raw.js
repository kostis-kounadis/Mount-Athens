import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '..', '_input');
const LINKS_FILE = path.join(__dirname, '..', 'LINKS.md');

// Ensure output directory exists
if (!fs.existsSync(INPUT_DIR)) {
  fs.mkdirSync(INPUT_DIR, { recursive: true });
}

// User-Agent to mimic a browser
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isChallengeOrBlockPage(html) {
  if (!html) return true;
  if (html.includes('Περιμένε μια στιγμή') || html.includes('Περιμένετε μια στιγμή')) return true;
  if (html.includes('Just a moment...') && html.includes('Cloudflare')) return true;
  if (html.includes('cf-browser-verification') || html.includes('challenge-running') || html.includes('cf_chl_prog')) return true;
  if (html.length < 15000 && html.includes('spinner') && html.includes('setTimeout')) return true;
  return false;
}

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Fetching (attempt ${attempt}/${retries}): ${url}...`);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      if (!response.ok) {
        if (attempt < retries && (response.status >= 500 || response.status === 429)) {
          console.warn(`Attempt ${attempt} returned HTTP ${response.status}. Retrying in ${attempt * 3}s...`);
          await new Promise(r => setTimeout(r, attempt * 3000));
          continue;
        }
        return { html: null, success: false, status: `HTTP error! status: ${response.status}`, code: response.status };
      }

      const html = await response.text();

      if (isChallengeOrBlockPage(html)) {
        if (attempt < retries) {
          console.warn(`Attempt ${attempt} received Cloudflare / anti-bot challenge page (${html.length} bytes). Retrying in ${attempt * 4}s...`);
          await new Promise(r => setTimeout(r, attempt * 4000));
          continue;
        }
        return { html: null, success: false, status: 'Cloudflare / Anti-bot Challenge Detected', code: 403 };
      }

      return { html, success: true, status: 'OK', code: response.status };
    } catch (error) {
      if (attempt < retries) {
        console.warn(`Attempt ${attempt} failed with network error: ${error.message}. Retrying in ${attempt * 3}s...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
        continue;
      }
      console.error(`Failed to fetch ${url} after ${retries} attempts:`, error.message);
      return { html: null, success: false, status: error.message, code: 0 };
    }
  }
}

function getSlug(url) {
  try {
    const parsed = new URL(url);
    let name = parsed.hostname.replace('www.', '');
    let pathname = parsed.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-');
    if (pathname) {
      name = `${name}_${pathname}`;
    }
    if (parsed.search) {
      const searchClean = parsed.search.replace(/^\?/, '').replace(/[&=]/g, '-');
      name = `${name}_${searchClean}`;
    }
    // Limit name length and remove non-alphanumeric chars for filename safety
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
  } catch (e) {
    return url.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  }
}

async function main() {
  if (!fs.existsSync(LINKS_FILE)) {
    console.error(`LINKS.md not found at ${LINKS_FILE}`);
    process.exit(1);
  }

  // Preserve previous content hashes if file exists
  const currentHashFile = path.join(__dirname, '../src/data/content-hashes.json');
  const oldHashFile = path.join(__dirname, '../src/data/content-hashes-old.json');
  if (fs.existsSync(currentHashFile)) {
    fs.copyFileSync(currentHashFile, oldHashFile);
  }

  const content = fs.readFileSync(LINKS_FILE, 'utf-8');
  const lines = content.split('\n');
  const linkConfig = {};
  let currentClub = '';

  const urlRegex = /https?:\/\/[^\s]+/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for Heading (# Club Name)
    if (trimmed.startsWith('#')) {
      currentClub = trimmed.replace(/^#\s*/, '').trim();
      linkConfig[currentClub] = [];
      continue;
    }

    // Check for List item (- URL)
    if (trimmed.startsWith('-') && currentClub) {
      const match = trimmed.match(urlRegex);
      if (match) {
        let cleanUrl = match[0].replace(/[,;()]$/, '').trim();
        linkConfig[currentClub].push(cleanUrl);
      }
    }
  }

  // Flatten active URLs for crawling
  const urls = [];
  for (const [club, clubUrls] of Object.entries(linkConfig)) {
    for (const url of clubUrls) {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
  }

  console.log(`Found ${urls.length} initial URLs to fetch in LINKS.md:`);
  urls.forEach((u, i) => console.log(`  [${i+1}] ${u}`));

  const fetchLogs = {};
  const contentHashes = {};

  // Process queue to allow dynamic link discovery
  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
    const slug = getSlug(url);
    const outputPath = path.join(INPUT_DIR, `${slug}.html`);
    
    const result = await fetchPage(url);
    fetchLogs[url] = {
      success: result.success,
      status: result.status,
      code: result.code,
      size: result.html ? result.html.length : 0
    };

    if (result.html) {
      fs.writeFileSync(outputPath, result.html, 'utf-8');
      console.log(`Saved ${url} -> ${outputPath} (${result.html.length} bytes)`);
      const hash = crypto.createHash('sha256').update(result.html).digest('hex');
      contentHashes[url] = hash;

      // Dynamic discovery for AOS seasonal program URLs
      if (url.includes('aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis')) {
        try {
          const $ = cheerio.load(result.html);
          $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.startsWith('https://aos.gr/programma-') && !href.includes('/tag/') && !href.includes('/category/') && !href.includes('/wp-content/')) {
              const cleanHref = href.split('#')[0].replace(/\/$/, '') + '/';
              if (!urls.includes(cleanHref)) {
                console.log(`✨ Dynamically discovered new AOS seasonal program URL: ${cleanHref}`);
                urls.push(cleanHref);
                if (linkConfig['ΑΟΣ'] && !linkConfig['ΑΟΣ'].includes(cleanHref)) {
                  linkConfig['ΑΟΣ'].push(cleanHref);
                }
              }
            }
          });
        } catch (e) {
          console.error('Error discovering AOS dynamic links:', e.message);
        }
      }

      // Dynamic pagination discovery for EPOS Filis Tribe Events REST API
      if (url.includes('eposfilis.gr/wp-json/tribe/events/v1/events')) {
        try {
          const parsed = JSON.parse(result.html);
          if (parsed && parsed.next_rest_url && parsed.next_rest_url.startsWith('https://eposfilis.gr/')) {
            const nextApiUrl = parsed.next_rest_url.trim();
            const pageMatch = nextApiUrl.match(/[?&]page=(\d+)/);
            const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 2;
            if (pageNum <= 5 && !urls.includes(nextApiUrl)) {
              console.log(`✨ Dynamically discovered EPOS Filis API pagination URL: ${nextApiUrl}`);
              urls.push(nextApiUrl);
              if (linkConfig['ΕΠΟΣ Φυλής'] && !linkConfig['ΕΠΟΣ Φυλής'].includes(nextApiUrl)) {
                linkConfig['ΕΠΟΣ Φυλής'].push(nextApiUrl);
              }
            }
          }
        } catch (e) {
          console.error('Error discovering EPOS Filis API pagination:', e.message);
        }
      }

      // Dynamic pagination discovery for EPOS Filis Tribe Events list view
      if (url.includes('eposfilis.gr/events/category/')) {
        try {
          const $ = cheerio.load(result.html);
          const nextHref = $('a.tribe-events-c-nav__next').attr('href');
          if (nextHref && nextHref.startsWith('https://eposfilis.gr/')) {
            const cleanNext = nextHref.split('#')[0].trim();
            // Cap pagination depth at 5 pages as a safety guard
            const pageMatch = cleanNext.match(/\/page\/(\d+)/);
            const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : 2;
            if (pageNum <= 5 && !urls.includes(cleanNext)) {
              console.log(`✨ Dynamically discovered EPOS Filis pagination URL: ${cleanNext}`);
              urls.push(cleanNext);
              if (linkConfig['ΕΠΟΣ Φυλής'] && !linkConfig['ΕΠΟΣ Φυλής'].includes(cleanNext)) {
                linkConfig['ΕΠΟΣ Φυλής'].push(cleanNext);
              }
            }
          }
        } catch (e) {
          console.error('Error discovering EPOS Filis pagination:', e.message);
        }
      }

      // Dynamic pagination discovery if EOS Acharnon HTML page is used
      if (url.includes('eosacharnon.xmiddleware.com/el') && !url.includes('page=')) {
        try {
          const $ = cheerio.load(result.html);
          const pageText = $('span:contains("Σελίδα")').text().trim();
          const m = pageText.match(/Σελίδα\s+1\s+από\s+(\d+)/i);
          if (m) {
            const totalPages = Math.min(parseInt(m[1], 10), 10);
            for (let p = 2; p <= totalPages; p++) {
              const nextUrl = `https://eosacharnon.xmiddleware.com/el?page=${p}`;
              if (!urls.includes(nextUrl)) {
                console.log(`✨ Dynamically discovered EOS Acharnon pagination URL: ${nextUrl}`);
                urls.push(nextUrl);
                if (linkConfig['ΕΟΣ Αχαρνών'] && !linkConfig['ΕΟΣ Αχαρνών'].includes(nextUrl)) {
                  linkConfig['ΕΟΣ Αχαρνών'].push(nextUrl);
                }
              }
            }
          }
        } catch (e) {
          console.error('Error discovering EOS Acharnon pagination:', e.message);
        }
      }
    }
    // Small delay between requests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Save the final structured config for parse-events.js
  const configPath = path.join(INPUT_DIR, 'link-config.json');
  fs.writeFileSync(configPath, JSON.stringify(linkConfig, null, 2), 'utf-8');
  console.log(`Saved link configuration mapping to ${configPath}`);

  const reportPath = path.join(INPUT_DIR, 'fetch-status.json');
  fs.writeFileSync(reportPath, JSON.stringify(fetchLogs, null, 2), 'utf-8');
  console.log(`Saved fetch report to ${reportPath}`);

  fs.writeFileSync(currentHashFile, JSON.stringify(contentHashes, null, 2), 'utf-8');
  console.log(`Saved content SHA-256 hashes to ${currentHashFile}`);

  console.log('\nAll crawls finished.');
}

main();
