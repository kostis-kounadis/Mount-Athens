import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

async function fetchPage(url) {
  console.log(`Fetching: ${url}...`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      return { html: null, success: false, status: `HTTP error! status: ${response.status}`, code: response.status };
    }

    const html = await response.text();
    return { html, success: true, status: 'OK', code: response.status };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return { html: null, success: false, status: error.message, code: 0 };
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

  // Save the structured config for parse-events.js
  const configPath = path.join(INPUT_DIR, 'link-config.json');
  fs.writeFileSync(configPath, JSON.stringify(linkConfig, null, 2), 'utf-8');
  console.log(`Saved link configuration mapping to ${configPath}`);

  // Flatten active URLs for crawling
  const urls = [];
  for (const [club, clubUrls] of Object.entries(linkConfig)) {
    for (const url of clubUrls) {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
  }

  console.log(`Found ${urls.length} URLs to fetch in LINKS.md:`);
  urls.forEach((u, i) => console.log(`  [${i+1}] ${u}`));

  const fetchLogs = {};

  for (const url of urls) {
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
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  const reportPath = path.join(INPUT_DIR, 'fetch-status.json');
  fs.writeFileSync(reportPath, JSON.stringify(fetchLogs, null, 2), 'utf-8');
  console.log(`Saved fetch report to ${reportPath}`);

  console.log('\nAll crawls finished.');
}

main();
