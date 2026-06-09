import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'data', 'debug-output.txt');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Initialize/clear file
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `Debug run at ${new Date().toISOString()}\n\n`, 'utf-8');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(OUTPUT_FILE, msg + '\n', 'utf-8');
}

async function test(url) {
  log(`=== Testing ${url} ===`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    log(`Status: ${response.status} ${response.statusText}`);
    log('Headers:');
    for (const [k, v] of response.headers.entries()) {
      log(`  ${k}: ${v}`);
    }
    const text = await response.text();
    log(`Length: ${text.length} chars`);
    log('Snippet (first 1000 chars):');
    log(text.substring(0, 1000));
  } catch (e) {
    log(`Fetch error: ${e.message}`);
  }
}

async function run() {
  try {
    await test('https://poa.gr/index.php/programma/');
    await test('https://eosh.gr/wp/product-category/greek-mountains-climbs/');
  } catch (e) {
    log(`Run error: ${e.message}`);
  }
}

run().catch(err => {
  console.error('Fatal unhandled error in run:', err);
});
