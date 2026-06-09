import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POA_FILE = path.join(__dirname, '..', '_input', 'poa_gr_index_php-programma.txt');

function main() {
  if (!fs.existsSync(POA_FILE)) {
    console.error('POA file not found');
    return;
  }
  
  const content = fs.readFileSync(POA_FILE, 'utf-8');
  const lines = content.split('\n');
  
  let currentMonth = '';
  let currentYear = '';
  
  const events = [];
  
  // Greek months lookup
  const GREEK_MONTHS = [
    'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Check if line is a month/year header (e.g., "Ιούνιος 2026")
    const monthHeaderMatch = line.match(/^([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})$/);
    if (monthHeaderMatch && GREEK_MONTHS.includes(monthHeaderMatch[1])) {
      currentMonth = monthHeaderMatch[1];
      currentYear = monthHeaderMatch[2];
      continue;
    }
    
    // Check if line looks like an event start: e.g. "13-14/6" or "14/6" or "7/6" followed by title
    // Let's match: starts with digit(s), optionallly followed by range, then slash, then digit(s), then space
    const eventMatch = line.match(/^(\d+(?:-\d+)?)\/(\d+)\s+(.+)$/);
    if (eventMatch && currentMonth) {
      const dateStr = eventMatch[1];
      const monthNum = eventMatch[2];
      const rest = eventMatch[3];
      
      // Extract title: it is usually uppercase or until some difficulty marker like "ΒΔ" or "ΥΔ"
      let title = rest;
      let difficulty = '';
      
      const bdMatch = rest.match(/(.+?)\s+(ΒΔ\s*[\d\w+]+|ΒΔ\s*X\d+|ΒΔ\s*Χ\d+)/i);
      if (bdMatch) {
        title = bdMatch[1].trim();
        difficulty = bdMatch[2].trim();
      }
      
      events.push({
        rawDate: `${dateStr}/${monthNum}`,
        monthHeader: `${currentMonth} ${currentYear}`,
        year: currentYear,
        month: monthNum,
        title: title.trim(),
        difficulty,
        rawLine: line
      });
    }
  }
  
  console.log(`Parsed ${events.length} events from POA:`);
  events.filter(e => e.year === '2026').forEach(e => {
    console.log(`- [${e.monthHeader}] ${e.rawDate}: ${e.title} (${e.difficulty})`);
  });
}

main();
