import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '..', '_input');

function cleanHtml(html) {
  const $ = cheerio.load(html);
  
  // Remove script, style, nav, footer, header elements
  $('script, style, nav, footer, header, iframe, noscript').remove();
  
  // Get text and replace multiple spaces/newlines with a single one
  let text = $('body').text();
  text = text.replace(/\s+/g, ' ');
  // Also extract table rows or bullet points with newlines if possible
  // Let's do a slightly smarter visible text extraction:
  const lines = [];
  $('p, h1, h2, h3, h4, h5, h6, li, tr, div').each((i, el) => {
    const txt = $(el).clone().children('script, style').remove().end().text().trim();
    if (txt && !lines.includes(txt)) {
      // Avoid adding child texts if parent text is already fully added,
      // but for simple flat extraction, a simple line list is fine.
      lines.push(txt);
    }
  });

  return lines.filter(l => l.length > 2).join('\n');
}

function main() {
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.html'));
  
  console.log(`Cleaning ${files.length} HTML files...`);
  
  for (const file of files) {
    const filePath = path.join(INPUT_DIR, file);
    const html = fs.readFileSync(filePath, 'utf-8');
    const cleanedText = cleanHtml(html);
    
    const txtFileName = file.replace('.html', '.txt');
    const outputPath = path.join(INPUT_DIR, txtFileName);
    fs.writeFileSync(outputPath, cleanedText, 'utf-8');
    console.log(`Cleaned: ${file} -> ${txtFileName} (${cleanedText.length} chars)`);
  }
  
  console.log('Done cleaning.');
}

main();
