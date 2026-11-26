import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSlug } from './fetch-raw.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INPUT_DIR = path.join(__dirname, '..', '_input');
const DEFAULT_OUTPUT_FILE = path.join(DEFAULT_INPUT_DIR, 'debug-output.txt');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function getFailedUrls(fetchStatus = {}) {
  return Object.entries(fetchStatus)
    .filter(([, info]) => !info || !info.success)
    .map(([url, info]) => ({
      url,
      slug: info?.slug || getSlug(url),
      status: info?.status || 'Unknown error',
      code: info?.code ?? 0
    }));
}

export async function probeFailedFetches({
  inputDir = DEFAULT_INPUT_DIR,
  outputFile = DEFAULT_OUTPUT_FILE,
  fetchImpl = fetch
} = {}) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const lines = [`Debug run at ${new Date().toISOString()}`, ''];
  const log = (msg) => {
    console.log(msg);
    lines.push(msg);
  };

  const fetchStatusPath = path.join(inputDir, 'fetch-status.json');
  if (!fs.existsSync(fetchStatusPath)) {
    log(`No fetch-status.json found at ${fetchStatusPath}. Nothing to probe.`);
    fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');
    return { probedCount: 0, failedUrls: [] };
  }

  let fetchStatus = {};
  try {
    fetchStatus = JSON.parse(fs.readFileSync(fetchStatusPath, 'utf-8'));
  } catch (err) {
    log(`Failed to parse fetch-status.json: ${err.message}`);
    fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');
    return { probedCount: 0, failedUrls: [] };
  }

  const totalUrls = Object.keys(fetchStatus).length;
  const failedUrls = getFailedUrls(fetchStatus);

  if (failedUrls.length === 0) {
    log(`All fetched URLs succeeded (${totalUrls}/${totalUrls}). No failure probes needed.`);
    fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');
    return { probedCount: 0, failedUrls: [] };
  }

  log(`Found ${failedUrls.length}/${totalUrls} failed URL(s). Probing for diagnostics...`);

  for (const item of failedUrls) {
    log('');
    log(`=== Failed URL: ${item.url} (previous: HTTP ${item.code} - ${item.status}) ===`);

    const savedFile = path.join(inputDir, `${item.slug}.html`);
    if (fs.existsSync(savedFile)) {
      const savedContent = fs.readFileSync(savedFile, 'utf-8');
      log(`Saved file exists (${savedFile}, ${savedContent.length} chars)`);
      log(`Saved snippet (first 500 chars): ${savedContent.substring(0, 500)}`);
    } else {
      log(`Saved file not present (${item.slug}.html) — expected when fetch failed.`);
    }

    try {
      const response = await fetchImpl(item.url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      log(`Fresh probe status: ${response.status} ${response.statusText || ''}`.trim());
      log('Key response headers:');
      const interestingHeaders = ['server', 'content-type', 'cf-ray', 'cf-mitigated', 'cf-cache-status', 'x-sucuri-id', 'location', 'retry-after'];
      for (const h of interestingHeaders) {
        const val = response.headers?.get?.(h);
        if (val) log(`  ${h}: ${val}`);
      }
      const text = await response.text();
      log(`Length: ${text.length} chars`);
      log('Snippet (first 600 chars):');
      log(text.substring(0, 600));
    } catch (err) {
      log(`Fresh probe error: ${err.message}`);
    }
  }

  fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');
  return { probedCount: failedUrls.length, failedUrls };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  probeFailedFetches().catch(err => {
    console.error('Fatal unhandled error in debug-fetch:', err);
  });
}
