import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '..', '_input');
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'data', 'events.json');

// Ensure src/data exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Current date threshold
const TODAY = new Date('2026-06-09');

// Month translation helper
const MONTH_MAP = {
  'ιαν': '01', 'ιανουαριος': '01', 'ιανουαριου': '01',
  'φεβ': '02', 'φεβρουαριος': '02', 'φεβρουαριου': '02',
  'μαρ': '03', 'μαρτιος': '03', 'μαρτιου': '03',
  'απρ': '04', 'απριλιος': '04', 'απριλιου': '04',
  'μαι': '05', 'μαϊ': '05', 'μαιος': '05', 'μαιου': '05', 'μαΐου': '05',
  'ιουν': '06', 'ιουνιος': '06', 'ιουνιου': '06', 'ιουνίου': '06',
  'ιουλ': '07', 'ιουλιος': '07', 'ιουλιου': '07', 'ιουλίου': '07',
  'αυγ': '08', 'αυγουστος': '08', 'αυγουστου': '08', 'αυγούστου': '08',
  'σεπ': '09', 'σεπτεμβριος': '09', 'σεπτεμβριου': '09', 'σεπτεμβρίου': '09',
  'οκτ': '10', 'οκτωβριος': '10', 'οκτωβριου': '10', 'οκτωβρίου': '10',
  'νοε': '11', 'νοεμβριος': '11', 'νοεμβριου': '11', 'νοεμβρίου': '11',
  'δεκ': '12', 'δεκεμβριος': '12', 'δεκεμβριου': '12', 'δεκεμβρίου': '12'
};

const ENGLISH_MONTHS = {
  'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
  'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12',
  'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
};

function stripGreekAccents(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[άά]/g, 'α')
    .replace(/[έέ]/g, 'ε')
    .replace(/[ήή]/g, 'η')
    .replace(/[ίίϊΐ]/g, 'ι')
    .replace(/[όό]/g, 'ο')
    .replace(/[ύύϋΰ]/g, 'υ')
    .replace(/[ώώ]/g, 'ω');
}

function parseGreekMonth(monthStr) {
  const clean = stripGreekAccents(monthStr).replace(/[^a-zα-ω]/g, '').trim();
  return MONTH_MAP[clean] || null;
}

function parseEnglishMonth(monthStr) {
  const clean = monthStr.toLowerCase().replace(/[^a-z]/g, '').trim();
  return ENGLISH_MONTHS[clean] || null;
}

function parseDateRange(dateText, defaultYear = 2026) {
  // Normalize and clean day names
  let cleanText = dateText
    .replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Format: "29 Μαΐου – 01 Ιουνίου 2026" or "21 Αυγούστου έως 30 Αυγούστου 2026"
  const rangeTwoMonthsMatch = cleanText.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s*(?:[-–—]|έως|εως)\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
  if (rangeTwoMonthsMatch) {
    const startDay = rangeTwoMonthsMatch[1].padStart(2, '0');
    const startMonthStr = rangeTwoMonthsMatch[2];
    const endDay = rangeTwoMonthsMatch[3].padStart(2, '0');
    const endMonthStr = rangeTwoMonthsMatch[4];
    const year = rangeTwoMonthsMatch[5];
    const startMonth = parseGreekMonth(startMonthStr) || '06';
    const endMonth = parseGreekMonth(endMonthStr) || '06';
    return {
      startDate: `${year}-${startMonth}-${startDay}`,
      endDate: `${year}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "12-14 Ιουνίου 2026" or "27-28 Ιουν 2026"
  const rangeMatch = cleanText.match(/^(\d+)\s*[-–—]\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
  if (rangeMatch) {
    const startDay = rangeMatch[1].padStart(2, '0');
    const endDay = rangeMatch[2].padStart(2, '0');
    const monthStr = rangeMatch[3];
    const year = rangeMatch[4];
    const month = parseGreekMonth(monthStr) || '06';
    return {
      startDate: `${year}-${month}-${startDay}`,
      endDate: `${year}-${month}-${endDay}`,
      displayDate: `${parseInt(startDay)}-${parseInt(endDay)} ${monthStr.substring(0, 4)}`
    };
  }

  // Format: "14 Ιουνίου 2026" or "05 Ιουλ 2026"
  const singleMatch = cleanText.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
  if (singleMatch) {
    const day = singleMatch[1].padStart(2, '0');
    const monthStr = singleMatch[2];
    const year = singleMatch[3];
    const month = parseGreekMonth(monthStr) || '06';
    return {
      startDate: `${year}-${month}-${day}`,
      endDate: `${year}-${month}-${day}`,
      displayDate: `${parseInt(day)} ${monthStr.substring(0, 4)}`
    };
  }

  // Format: "30/5 - 1/6" or "30/5 – 1/6"
  const poaRangeTwoMonthsMatch = cleanText.match(/^(\d+)\s*\/\s*(\d+)\s*[-–—]\s*(\d+)\s*\/\s*(\d+)(?:\/\d{4})?/);
  if (poaRangeTwoMonthsMatch) {
    const startDay = poaRangeTwoMonthsMatch[1].padStart(2, '0');
    const startMonth = poaRangeTwoMonthsMatch[2].padStart(2, '0');
    const endDay = poaRangeTwoMonthsMatch[3].padStart(2, '0');
    const endMonth = poaRangeTwoMonthsMatch[4].padStart(2, '0');
    const year = poaRangeTwoMonthsMatch[5] || defaultYear;
    return {
      startDate: `${year}-${startMonth}-${startDay}`,
      endDate: `${year}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "12-14/6" or "17 – 18/1/2026"
  const poaRangeMatch = cleanText.match(/^(\d+)\s*[-–—]\s*(\d+)\s*\/\s*(\d+)(?:\/(\d{4}))?/);
  if (poaRangeMatch) {
    const startDay = poaRangeMatch[1].padStart(2, '0');
    const endDay = poaRangeMatch[2].padStart(2, '0');
    const month = poaRangeMatch[3].padStart(2, '0');
    const year = poaRangeMatch[4] || defaultYear;
    return {
      startDate: `${year}-${month}-${startDay}`,
      endDate: `${year}-${month}-${endDay}`,
      displayDate: `${parseInt(startDay)}-${parseInt(endDay)}/${parseInt(month)}`
    };
  }

  // Format: "14/6" or "6/9/2026"
  const poaSingleMatch = cleanText.match(/^(\d+)\s*\/\s*(\d+)(?:\/(\d{4}))?/);
  if (poaSingleMatch) {
    const day = poaSingleMatch[1].padStart(2, '0');
    const month = poaSingleMatch[2].padStart(2, '0');
    const year = poaSingleMatch[3] || defaultYear;
    return {
      startDate: `${year}-${month}-${day}`,
      endDate: `${year}-${month}-${day}`,
      displayDate: `${parseInt(day)}/${parseInt(month)}`
    };
  }

  // Fail-safe default
  return {
    startDate: `${defaultYear}-06-09`,
    endDate: `${defaultYear}-06-09`,
    displayDate: dateText
  };
}

// ----------------------------------------------------
// PARSER: EOS Acharnon (Cheerio from HTML)
// ----------------------------------------------------
function parseEosAcharnon() {
  const htmlPath = path.join(INPUT_DIR, 'eosacharnon_xmiddleware_com_el.html');
  if (!fs.existsSync(htmlPath)) return [];
  
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const events = [];

  $('div[data-slot="card"]').each((i, el) => {
    // Exclude cards that don't look like events (e.g. search filters)
    const title = $(el).find('div[data-slot="card-title"]').text().trim();
    if (!title) return;
    
    // Find the date text. In Acharnon: it's inside the card-description usually, e.g. "(6-16 Ιουνίου ’26)" or badge
    const desc = $(el).find('div[data-slot="card-description"]').text().trim();
    const badge = $(el).find('span[data-slot="badge"]').text().trim();
    
    // Attempt to extract the date range.
    // e.g. "(6-16 Ιουνίου ’26)" or "11 Ιουν 2026 - 13 Ιουν 2026"
    let dateRangeStr = '';
    const dateMatch = desc.match(/\((\d+(?:-\d+)?\s+[Α-Ωα-ωίϊΐόάέύώήώ’']+\s*['’]\d{2})\)/i) || 
                      desc.match(/(\d+[\sΑ-Ωα-ωίϊΐόάέύώήώ]+\s*-\s*\d+[\sΑ-Ωα-ωίϊΐόάέύώήώ’']+\s*['’]\d{2})/i) ||
                      desc.match(/(\d+[\sΑ-Ωα-ωίϊΐόάέύώήώ]+\d{4}\s*-\s*\d+[\sΑ-Ωα-ωίϊΐόάέύώήώ]+\d{4})/i);
    
    if (dateMatch) {
      dateRangeStr = dateMatch[1];
    } else {
      // Look for a raw range like "11 Ιουν 2026 - 13 Ιουν 2026" or similar
      const rawRangeMatch = desc.match(/(\d+(?:-\d+)?\s+[Α-Ωα-ωίϊΐόάέύώήώ]+(?:\s+20\d{2})?\s*-\s*\d+\s+[Α-Ωα-ωίϊΐόάέύώήώ]+\s+20\d{2})/i);
      if (rawRangeMatch) {
        dateRangeStr = rawRangeMatch[1];
      } else {
        // Fallback to badge
        dateRangeStr = badge;
      }
    }

    // Parse dateRangeStr into standardized dates
    let startDate = '2026-06-05';
    let endDate = '2026-06-05';
    let displayDate = badge || dateRangeStr;

    // Standardize Acharnon Greek date format: "(6-16 Ιουνίου ’26)"
    if (dateRangeStr) {
      // Remove parentheses
      let clean = dateRangeStr.replace(/[()]/g, '').trim();
      // "6-16 Ιουνίου ’26" -> "6-16 Ιουνίου 2026"
      clean = clean.replace(/['’](\d{2})/, '20$1');
      
      // Try to parse range
      // "6-16 Ιουνίου 2026"
      const rMatch = clean.match(/^(\d+)-(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
      if (rMatch) {
        const sDay = rMatch[1].padStart(2, '0');
        const eDay = rMatch[2].padStart(2, '0');
        const monthStr = rMatch[3];
        const year = rMatch[4];
        const month = parseGreekMonth(monthStr) || '06';
        startDate = `${year}-${month}-${sDay}`;
        endDate = `${year}-${month}-${eDay}`;
        displayDate = `${parseInt(sDay)}-${parseInt(eDay)} ${monthStr.substring(0, 4)}`;
      } else {
        // Single day or other format
        const sMatch = clean.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
        if (sMatch) {
          const day = sMatch[1].padStart(2, '0');
          const monthStr = sMatch[2];
          const year = sMatch[3];
          const month = parseGreekMonth(monthStr) || '06';
          startDate = `${year}-${month}-${day}`;
          endDate = `${year}-${month}-${day}`;
          displayDate = `${parseInt(day)} ${monthStr.substring(0, 4)}`;
        }
      }
    }

    events.push({
      startDate,
      endDate,
      displayDate,
      title: title.replace(/\s+/g, ' ').trim(),
      club: 'ΕΟΣ Αχαρνών',
      url: 'https://eosacharnon.gr/booking/',
      difficulty: desc.includes('Δυσκολία:') ? desc.match(/Δυσκολία:\s*([Α-Γ\d+-]+)/)?.[1] || '' : ''
    });
  });

  return events;
}

// ----------------------------------------------------
// PARSER: AOS (Text-based)
// ----------------------------------------------------
function parseAos() {
  const txtPath = path.join(INPUT_DIR, 'aos_gr_trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  let currentMonthHeader = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for month header like "Ιουνιος 2026"
    if (/^[Α-Ωα-ωίϊΐόάέύώήώ]+\s+\d{4}$/.test(line) && !line.includes('Δηλώσεις')) {
      currentMonthHeader = line;
      continue;
    }

    // Check for date line:
    // "12-14 Ιουνίου 2026" or "14 Ιουνίου 2026"
    const isRange = /^(\d+)-(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
    const isSingle = /^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
    const isMultiMonth = /^Παρασκευή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+έως\s+Κυριακή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
    const isMultiMonthSep = /^Παρασκευή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+έως\s+Τρίτη\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);

    if (isRange || isSingle || isMultiMonth || isMultiMonthSep) {
      const dateStr = line;
      // Next line should be title
      let title = '';
      if (lines[i+1]) title = lines[i+1].trim();
      
      // Try to parse dates
      let parsed = parseDateRange(dateStr);
      
      if (parsed) {
        events.push({
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          displayDate: parsed.displayDate,
          title,
          club: 'ΑΟΣ',
          url: 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/',
          difficulty: ''
        });
      }
    }
  }

  // Deduplicate events by title & startDate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: POA (Text-based)
// ----------------------------------------------------
function parsePoa() {
  const txtPath = path.join(INPUT_DIR, 'poa_gr_index_php-programma.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  let currentMonth = '';
  let currentYear = '2026'; // Default

  const GREEK_MONTHS_MAP = {
    'ιανουαριος': '01', 'φεβρουαριος': '02', 'μαρτιος': '03', 'απριλιος': '04', 'μαιος': '05', 'ιουνιος': '06',
    'ιουλιος': '07', 'αυγουστος': '08', 'σεπτεμβριος': '09', 'οκτωβριος': '10', 'νοεμβριος': '11', 'δεκεμβριος': '12'
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const monthHeaderMatch = line.match(/^([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})$/);
    if (monthHeaderMatch) {
      const mName = stripGreekAccents(monthHeaderMatch[1]).trim();
      if (GREEK_MONTHS_MAP[mName]) {
        currentMonth = GREEK_MONTHS_MAP[mName];
        currentYear = monthHeaderMatch[2];
        continue;
      }
    }

    // Match cross-month range: e.g. "30-31/12 – 1/1" or "29/5 – 1/6" followed by title
    const crossMonthMatch = line.match(/^(\d+(?:-\d+)?)\/(\d+)\s*[-–—]\s*(\d+(?:-\d+)?)\/(\d+)\s+(.+)$/);
    if (crossMonthMatch && currentMonth) {
      const startDayPart = crossMonthMatch[1];
      const startMonth = crossMonthMatch[2].padStart(2, '0');
      const endDayPart = crossMonthMatch[3];
      const endMonth = crossMonthMatch[4].padStart(2, '0');
      const rest = crossMonthMatch[5].trim();

      // Skip itinerary lines
      const cleanRest = stripGreekAccents(rest);
      const isItinerary = /^(δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)(\s|:|$)/i.test(cleanRest);
      if (isItinerary) continue;

      const startDay = startDayPart.split('-')[0];
      const endDay = endDayPart.split('-').pop() || '';

      let title = rest;
      let difficulty = '';
      const bdMatch = rest.match(/(.+?)\s+(ΒΔ\s*[\d\w+]+|ΒΔ\s*X\d+|ΒΔ\s*Χ\d+)/i);
      if (bdMatch) {
        title = bdMatch[1].trim();
        difficulty = bdMatch[2].trim();
      }

      let endYear = currentYear;
      if (parseInt(endMonth) < parseInt(startMonth)) {
        endYear = String(parseInt(currentYear) + 1);
      }

      events.push({
        startDate: `${currentYear}-${startMonth}-${startDay.padStart(2, '0')}`,
        endDate: `${endYear}-${endMonth}-${endDay.padStart(2, '0')}`,
        displayDate: `${startDayPart}/${parseInt(startMonth)} - ${endDayPart}/${parseInt(endMonth)}`,
        title: title.replace(/\s+/g, ' ').trim(),
        club: 'ΠΟΑ',
        url: 'https://poa.gr/index.php/programma/',
        difficulty
      });
      continue;
    }

    // Match single-month date/range: e.g. "23 – 30/6" or "16-18/1" or "14/12" followed by title
    const singleMonthMatch = line.match(/^(\d+(?:\s*[-–—]\s*\d+)?)\/(\d+)\s+(.+)$/);
    if (singleMonthMatch && currentMonth) {
      const dayPart = singleMonthMatch[1];
      const monthNum = singleMonthMatch[2].padStart(2, '0');
      const rest = singleMonthMatch[3].trim();

      // Skip itinerary lines
      const cleanRest = stripGreekAccents(rest);
      const isItinerary = /^(δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)(\s|:|$)/i.test(cleanRest);
      if (isItinerary) continue;

      let title = rest;
      let difficulty = '';
      const bdMatch = rest.match(/(.+?)\s+(ΒΔ\s*[\d\w+]+|ΒΔ\s*X\d+|ΒΔ\s*Χ\d+)/i);
      if (bdMatch) {
        title = bdMatch[1].trim();
        difficulty = bdMatch[2].trim();
      }

      const dayPartClean = dayPart.replace(/\s*[-–—]\s*/g, '-').trim();
      let startDate = '';
      let endDate = '';
      let displayDate = '';

      if (dayPartClean.includes('-')) {
        const [startDay, endDay] = dayPartClean.split('-');
        startDate = `${currentYear}-${monthNum}-${startDay.padStart(2, '0')}`;
        endDate = `${currentYear}-${monthNum}-${endDay.padStart(2, '0')}`;
        displayDate = `${startDay}-${endDay}/${parseInt(monthNum)}`;
      } else {
        startDate = `${currentYear}-${monthNum}-${dayPartClean.padStart(2, '0')}`;
        endDate = `${currentYear}-${monthNum}-${dayPartClean.padStart(2, '0')}`;
        displayDate = `${dayPartClean}/${parseInt(monthNum)}`;
      }

      events.push({
        startDate,
        endDate,
        displayDate,
        title: title.replace(/\s+/g, ' ').trim(),
        club: 'ΠΟΑ',
        url: 'https://poa.gr/index.php/programma/',
        difficulty
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: EOS Athinon (Text-based)
// ----------------------------------------------------
function parseEosAthinon() {
  const txtPath = path.join(INPUT_DIR, 'eosathinon_gr_anavaseis-programma.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  let currentYear = 2026;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Find lines starting with calendar icon 📅
    if (line.startsWith('📅')) {
      let cleanLine = line.replace('📅', '').trim();
      
      let datePart = '';
      const rangeTwoMonths = cleanLine.match(/(\d+\/\d+\s*[-–—]\s*\d+\/\d+)/);
      const rangeOneMonth = cleanLine.match(/(\d+(?:\s*[-–—]\s*\d+)?\s*\/\s*\d+(?:\/\d{4})?)/);
      const singleDate = cleanLine.match(/(\d+\/\d+(?:\/\d{4})?)/);

      if (rangeTwoMonths) {
        datePart = rangeTwoMonths[0];
      } else if (rangeOneMonth) {
        datePart = rangeOneMonth[0];
      } else if (singleDate) {
        datePart = singleDate[0];
      }

      if (!datePart) continue;

      // Title is everything else with day names and leading/trailing punctuation stripped
      let titlePart = cleanLine.replace(datePart, '');
      titlePart = titlePart.replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '');
      titlePart = titlePart
        .replace(/^[–\-:\s]+|[–\-:\s]+$/g, '') // Strip leading/trailing dashes, colons, spaces
        .replace(/\s+/g, ' ')
        .trim();

      // Clean title from departure times
      titlePart = titlePart.split(/\d+:/)[0].trim().replace(/[–\-:\s]+$/, '');

      // Parse datePart
      const parsed = parseDateRange(datePart, currentYear);

      if (parsed) {
        events.push({
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          displayDate: parsed.displayDate,
          title: titlePart,
          club: 'ΕΟΣ Αθηνών',
          url: 'https://www.eosathinon.gr/anavaseis/programma/',
          difficulty: ''
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: EOS Halandriou / Ilioupolis (Text-based)
// ----------------------------------------------------
function parseEosHalioupolis() {
  const txtPath = path.join(INPUT_DIR, 'eosh_gr_wp-product-category-greek-mountains-climbs.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Format: "13 Ιουν 2026: Υμηττός (μουσική βραδιά στο καταφύγιο)"
    // Format: "27-28 Ιουν 2026: Ερύμανθος (Μουγγίλα)"
    const match = line.match(/^(\d+(?:-\d+)?)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4}):\s*(.+)$/i);
    if (match) {
      const dayStr = match[1];
      const monthStr = match[2];
      const year = match[3];
      const title = match[4];
      
      const monthNum = parseGreekMonth(monthStr) || '06';

      let startDate = '';
      let endDate = '';
      let displayDate = `${dayStr} ${monthStr.substring(0, 4)}`;

      if (dayStr.includes('-')) {
        const [sDay, eDay] = dayStr.split('-');
        startDate = `${year}-${monthNum}-${sDay.padStart(2, '0')}`;
        endDate = `${year}-${monthNum}-${eDay.padStart(2, '0')}`;
      } else {
        startDate = `${year}-${monthNum}-${dayStr.padStart(2, '0')}`;
        endDate = `${year}-${monthNum}-${dayStr.padStart(2, '0')}`;
      }

      events.push({
        startDate,
        endDate,
        displayDate,
        title: title.trim(),
        club: 'ΕΟΣ Ηλιούπολης',
        url: 'https://eosh.gr/wp/product-category/greek-mountains-climbs/',
        difficulty: ''
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: FONI (Text-based)
// ----------------------------------------------------
function parseFoni() {
  const txtPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Example: "07 Ιουνίου 2026 / Καλοκαιρινή περιηγητική : Αγκίστρι"
    // Example: "29 Μαΐου – 01 Ιουνίου 2026 / Πεζοπορική – Άνδρος"
    const match = line.match(/^([^/]+)\s*\/\s*(?:Πεζοπορική|Καλοκαιρινή|Περιηγητική|Εκδρομές)\s*[:–-]\s*(.+)$/i);
    if (match) {
      const dateText = match[1].trim();
      const title = match[2].trim();

      const parsed = parseDateRange(dateText);
      if (parsed) {
        events.push({
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          displayDate: parsed.displayDate,
          title,
          club: 'ΦΟΝΙ',
          url: 'https://www.foni.org.gr/category/ekdromes/',
          difficulty: ''
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: EPOS Filis (Text-based)
// ----------------------------------------------------
function parseEposFilis() {
  const txtPath = path.join(INPUT_DIR, 'eposfilis_gr_events-category-_ce_b7_ce_bc_ce_b5_cf_81_ce_bf_ce_bb_cf_8c_ce_b3_ce_b9_ce_bf.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  let currentYear = 2026;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Look for event descriptions or headers
    // Example: "13-14/6 Ταΰγετος: Δάσος της Βασιλικής - Προφήτης Ηλίας (2.407μ.) – Αναβρυτή (2ήμερη διάσχιση)"
    // Example: "ΜΕΘΑΝΑ 21/06 Αναχώρηση στις..."
    // Example: "28/8-1/9 Αλόννησος: εκεί που..."
    
    // Pattern 1: Starts with date e.g. "13-14/6"
    const pattern1 = line.match(/^(\d+(?:-\d+)?)\/(\d+)\s+(.+)$/);
    if (pattern1) {
      const dateStr = pattern1[1];
      const monthNum = pattern1[2].padStart(2, '0');
      const rest = pattern1[3];
      
      let title = rest.split(/Πεζοπορίες|Αναχώρηση|Ενεργοποίηση/i)[0].trim();
      title = title.replace(/[:–-]$/, '').trim();

      let startDate = '';
      let endDate = '';
      let displayDate = '';

      if (dateStr.includes('-')) {
        const [sDay, eDay] = dateStr.split('-');
        startDate = `${currentYear}-${monthNum}-${sDay.padStart(2, '0')}`;
        endDate = `${currentYear}-${monthNum}-${eDay.padStart(2, '0')}`;
        displayDate = `${sDay}-${eDay}/${parseInt(monthNum)}`;
      } else {
        startDate = `${currentYear}-${monthNum}-${dateStr.padStart(2, '0')}`;
        endDate = `${currentYear}-${monthNum}-${dateStr.padStart(2, '0')}`;
        displayDate = `${dateStr}/${parseInt(monthNum)}`;
      }

      events.push({
        startDate,
        endDate,
        displayDate,
        title,
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/events/category/ημερολόγιο/',
        difficulty: ''
      });
    }

    // Pattern 2: "ΜΕΘΑΝΑ 21/06"
    const pattern2 = line.match(/^([A-ZΑ-Ωα-ωίϊΐόάέύώήώ\s]+)\s+(\d{2})\/(\d{2})/i);
    if (pattern2 && !line.includes('Ανακοινώσεις') && !line.includes('Δελτίο Τύπου')) {
      const name = pattern2[1].trim();
      const day = pattern2[2];
      const month = pattern2[3];

      events.push({
        startDate: `${currentYear}-${month}-${day}`,
        endDate: `${currentYear}-${month}-${day}`,
        displayDate: `${parseInt(day)}/${parseInt(month)}`,
        title: name,
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/events/category/ημερολόγιο/',
        difficulty: ''
      });
    }

    // Pattern 3: "28/8-1/9 Αλόννησος: ..."
    const pattern3 = line.match(/^(\d+)\/(\d+)-(\d+)\/(\d+)\s+(.+)$/);
    if (pattern3) {
      const sDay = pattern3[1].padStart(2, '0');
      const sMonth = pattern3[2].padStart(2, '0');
      const eDay = pattern3[3].padStart(2, '0');
      const eMonth = pattern3[4].padStart(2, '0');
      const rest = pattern3[5];

      let title = rest.split(/εκεί|Αναχώρηση/i)[0].trim();
      title = title.replace(/[:–-]$/, '').trim();

      events.push({
        startDate: `${currentYear}-${sMonth}-${sDay}`,
        endDate: `${currentYear}-${eMonth}-${eDay}`,
        displayDate: `${parseInt(sDay)}/${parseInt(sMonth)} - ${parseInt(eDay)}/${parseInt(eMonth)}`,
        title,
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/events/category/ημερολόγιο/',
        difficulty: ''
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// MAIN AGGREGATOR
// ----------------------------------------------------
function main() {
  console.log('Starting parsing across all clubs...');
  
  let allEvents = [];

  try {
    const acharnon = parseEosAcharnon();
    console.log(`Parsed ${acharnon.length} events from EOS Acharnon`);
    allEvents = allEvents.concat(acharnon);
  } catch (e) {
    console.error('Error parsing EOS Acharnon:', e.message);
  }

  try {
    const aos = parseAos();
    console.log(`Parsed ${aos.length} events from AOS`);
    allEvents = allEvents.concat(aos);
  } catch (e) {
    console.error('Error parsing AOS:', e.message);
  }

  try {
    const poa = parsePoa();
    console.log(`Parsed ${poa.length} events from POA`);
    allEvents = allEvents.concat(poa);
  } catch (e) {
    console.error('Error parsing POA:', e.message);
  }

  try {
    const athinon = parseEosAthinon();
    console.log(`Parsed ${athinon.length} events from EOS Athinon`);
    allEvents = allEvents.concat(athinon);
  } catch (e) {
    console.error('Error parsing EOS Athinon:', e.message);
  }

  try {
    const hlioupolis = parseEosHalioupolis();
    console.log(`Parsed ${hlioupolis.length} events from EOS Hlioupolis`);
    allEvents = allEvents.concat(hlioupolis);
  } catch (e) {
    console.error('Error parsing EOS Hlioupolis:', e.message);
  }

  try {
    const foni = parseFoni();
    console.log(`Parsed ${foni.length} events from FONI`);
    allEvents = allEvents.concat(foni);
  } catch (e) {
    console.error('Error parsing FONI:', e.message);
  }

  try {
    const filis = parseEposFilis();
    console.log(`Parsed ${filis.length} events from EPOS Filis`);
    allEvents = allEvents.concat(filis);
  } catch (e) {
    console.error('Error parsing EPOS Filis:', e.message);
  }

  // Filter out invalid dates, and only include events from TODAY onwards
  // Since we also want to display events starting in June 2026, let's filter correctly
  allEvents = allEvents.filter(e => {
    if (!e.startDate || e.startDate === 'NaN-NaN-NaN') return false;
    const evDate = new Date(e.startDate);
    // Keep only future/current events (from TODAY onwards)
    return evDate >= TODAY;
  });

  // Sort chronologically by startDate
  allEvents.sort((a, b) => {
    return new Date(a.startDate) - new Date(b.startDate);
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allEvents, null, 2), 'utf-8');
  console.log(`\nSuccessfully aggregated and saved ${allEvents.length} upcoming events to ${OUTPUT_FILE}`);
}

main();
