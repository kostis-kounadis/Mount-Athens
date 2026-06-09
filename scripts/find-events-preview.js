import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '..', '_input');

const MONTHS = [
  'Ιανουάρ', 'Φεβρουάρ', 'Μάρτ', 'Απρίλ', 'Μάι', 'Μαΐ', 'Ιούν', 'Ιούλ', 'Αύγουστ', 'Σεπτέμβρ', 'Οκτώβρ', 'Νοέμβρ', 'Δεκέμβρ',
  'Ιαν', 'Φεβ', 'μαρ', 'απρ', 'μαι', 'ιουν', 'ιουλ', 'αυγ', 'σεπ', 'οκτ', 'νοε', 'δεκ'
];

function checkFile(fileName) {
  const filePath = path.join(INPUT_DIR, fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  console.log(`\n==================================================`);
  console.log(`FILE: ${fileName}`);
  console.log(`==================================================`);
  
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Check if the line contains a month name and some numbers (dates)
    const hasMonth = MONTHS.some(m => line.toLowerCase().includes(m.toLowerCase()));
    const hasNumber = /\d+/.test(line);
    
    if (hasMonth && hasNumber && line.length < 150) {
      console.log(`Line ${i+1}: ${line}`);
      // Also show the next 2 lines to see the context/title
      for (let j = 1; j <= 2; j++) {
        if (lines[i+j]) {
          console.log(`  +${j}: ${lines[i+j].trim()}`);
        }
      }
      count++;
      if (count > 25) {
        console.log('... truncated ...');
        break;
      }
    }
  }
}

function main() {
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.txt'));
  for (const file of files) {
    if (file.includes('eosacharnon_xmiddleware') || file.includes('aos_gr_trechouses')) {
      // We already saw these or they are easy, let's look at others
    }
    checkFile(file);
  }
}

main();
