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

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Fetching (attempt ${attempt}/${retries}): ${url}...`);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7',
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
            if (href && href.startsWith('https://aos.gr/programma-exormiseon-') && !href.includes('/tag/') && !href.includes('/category/')) {
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
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1500));
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
