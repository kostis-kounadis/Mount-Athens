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

// Current date threshold in Europe/Athens timezone
const athensFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const TODAY = new Date(athensFormatter.format(new Date()));

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

function cleanWord(word) {
  return stripGreekAccents(word)
    .toLowerCase()
    .replace(/[^a-zα-ω0-9]/g, '')
    .trim();
}

function getSignificantWords(text) {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map(cleanWord)
    .filter(w => w.length > 2 && !['και', 'του', 'της', 'στο', 'στα', 'εως', 'απο', 'για', 'από', 'αρα', 'εχει', 'μας', 'στον', 'στην', 'στη'].includes(w));
}

function matchTitleToUrl(parsedTitle, urlMap, defaultUrl) {
  const parsedWords = getSignificantWords(parsedTitle);
  if (parsedWords.length === 0) return defaultUrl;

  let bestUrl = defaultUrl;
  let maxMatchRatio = 0.5; // Threshold: at least 50% overlap of the smaller set of words

  for (const [key, url] of Object.entries(urlMap)) {
    const keyWords = getSignificantWords(key);
    if (keyWords.length === 0) continue;

    // Count overlap
    const overlap = parsedWords.filter(w => keyWords.includes(w));
    const ratio = overlap.length / Math.min(parsedWords.length, keyWords.length);

    if (ratio > maxMatchRatio) {
      maxMatchRatio = ratio;
      bestUrl = url;
    }
  }

  return bestUrl;
}

function parseDateRange(dateText, defaultYear = 2026) {
  // Normalize and clean day names
  let cleanText = dateText
    .replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Format: "11 Ιουν 2026 - 13 Ιουν 2026"
  const rangeTwoYearsMatch = cleanText.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})\s*[-–—]\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i);
  if (rangeTwoYearsMatch) {
    const startDay = rangeTwoYearsMatch[1].padStart(2, '0');
    const startMonthStr = rangeTwoYearsMatch[2];
    const startYear = rangeTwoYearsMatch[3];
    const endDay = rangeTwoYearsMatch[4].padStart(2, '0');
    const endMonthStr = rangeTwoYearsMatch[5];
    const endYear = rangeTwoYearsMatch[6];
    const startMonth = parseGreekMonth(startMonthStr) || '06';
    const endMonth = parseGreekMonth(endMonthStr) || '06';
    return {
      startDate: `${startYear}-${startMonth}-${startDay}`,
      endDate: `${endYear}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

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

  // Gather all __next_f.push content from Next.js hydration payload
  let nextDataRaw = '';
  $('script').each((i, el) => {
    const text = $(el).text();
    if (text.includes('self.__next_f.push')) {
      const match = text.match(/self\.__next_f\.push\(\[\d+,\s*"(.*)"\]\)/s);
      if (match) {
        let content = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\');
        nextDataRaw += content;
      } else {
        const match2 = text.match(/self\.__next_f\.push\(\[\d+,\s*'(.*)'\]\)/s);
        if (match2) {
          let content = match2[1]
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
          nextDataRaw += content;
        }
      }
    }
  });

  const eventsIndex = nextDataRaw.indexOf('"events":[');
  if (eventsIndex === -1) return [];

  let bracketCount = 1;
  let i = eventsIndex + 10;
  let start = i - 1;
  
  while (i < nextDataRaw.length && bracketCount > 0) {
    if (nextDataRaw[i] === '[') bracketCount++;
    else if (nextDataRaw[i] === ']') bracketCount--;
    i++;
  }
  
  const eventsJsonStr = nextDataRaw.substring(start, i);
  const cleanJsonStr = eventsJsonStr
    .replace(/"\$D(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)"/g, '"$1"');
    
  try {
    const rawEvents = JSON.parse(cleanJsonStr);
    
    const DIFFICULTY_MAP = {
      'A': 'Α',
      'A_PLUS': 'Α+',
      'B': 'Β',
      'B_PLUS': 'Β+',
      'C': 'Γ',
      'C_PLUS': 'Γ+',
      'D': 'Δ'
    };

    rawEvents.forEach(ev => {
      // 1. Correct timezone offset: add 3 hours to UTC dates to get correct Greek local dates
      const adjustDate = (dateStr) => {
        if (!dateStr) return '';
        const utcDate = new Date(dateStr);
        if (isNaN(utcDate.getTime())) return '';
        // Shift by +3 hours to align database UTC date with local Athens calendar date
        const localDate = new Date(utcDate.getTime() + 3 * 60 * 60 * 1000);
        return localDate.toISOString().split('T')[0];
      };
      
      const startDate = adjustDate(ev.startDate);
      const endDate = adjustDate(ev.endDate);
      
      // 2. Format display date range
      let displayDate = '';
      if (startDate && endDate) {
        const startParts = startDate.split('-');
        const endParts = endDate.split('-');
        const startDay = parseInt(startParts[2]);
        const startMonth = parseInt(startParts[1]);
        const endDay = parseInt(endParts[2]);
        const endMonth = parseInt(endParts[1]);
        
        if (startDate === endDate) {
          displayDate = `${startDay}/${startMonth}`;
        } else if (startMonth === endMonth) {
          displayDate = `${startDay}-${endDay}/${startMonth}`;
        } else {
          displayDate = `${startDay}/${startMonth} - ${endDay}/${endMonth}`;
        }
      }
      
      // 3. Set direct booking URL to xmiddleware
      const relativeHref = ev.id ? `/el/booking/${ev.id}` : '';
      const url = relativeHref 
        ? `https://eosacharnon.xmiddleware.com${relativeHref}` 
        : 'https://eosacharnon.xmiddleware.com/el/booking';
      
      // 4. Set mapped difficulty
      const difficulty = ev.difficulties && ev.difficulties.length > 0 
        ? ev.difficulties.map(d => DIFFICULTY_MAP[d] || d).join(', ') 
        : '';
      
      events.push({
        startDate,
        endDate,
        displayDate,
        title: ev.title ? ev.title.trim() : '',
        club: 'ΕΟΣ Αχαρνών',
        url,
        difficulty
      });
    });
  } catch (err) {
    console.error('Failed to parse Acharnon Next.js hydration payload:', err.message);
  }

  return events;
}

// ----------------------------------------------------
// PARSER: AOS (Text-based)
// ----------------------------------------------------
function parseAos() {
  const txtPath = path.join(INPUT_DIR, 'aos_gr_trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis.txt');
  if (!fs.existsSync(txtPath)) return [];

  // Build URL Map from raw HTML files
  const urlMap = {};
  const aosHtmlFiles = [
    'aos_gr_trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis.html',
    'aos_gr_programma-exormiseon-ianouarios-2026-septemvrios-2026.html'
  ];
  for (const file of aosHtmlFiles) {
    const filePath = path.join(INPUT_DIR, file);
    if (fs.existsSync(filePath)) {
      const html = fs.readFileSync(filePath, 'utf-8');
      const $ = cheerio.load(html);
      let lastSeenTitle = '';
      $('*').each((i, el) => {
        const tagName = el.tagName.toLowerCase();
        const text = $(el).text().trim();
        
        if (tagName === 'h2' || tagName === 'h3' || (tagName === 'p' && $(el).find('strong').length > 0)) {
          if (text.length > 5 && text.length < 150) {
            lastSeenTitle = text;
          }
        }
        
        if (tagName === 'a') {
          const href = $(el).attr('href');
          if (href && href.startsWith('https://aos.gr/') && !href.includes('/category/') && !href.includes('/feed/') && !href.includes('/wp-content/') && href.length > 25) {
            const cleanText = stripGreekAccents(text);
            if (cleanText.includes('λεπτομερειες') || cleanText.includes('δηλωση') || cleanText.includes('πατηστε') || cleanText.includes('details')) {
              if (lastSeenTitle) {
                urlMap[lastSeenTitle] = href;
              }
            }
          }
        }
      });
    }
  }

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  let currentMonthHeader = '';
  const defaultUrl = 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/';
  
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
          url: matchTitleToUrl(title, urlMap, defaultUrl),
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

  // Parse HTML to extract anchor IDs for accordion auto-scrolling
  const poaUrlMap = {};
  const htmlPath = path.join(INPUT_DIR, 'poa_gr_index_php-programma.html');
  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('.elementor-toggle-item').each((i, el) => {
        const titleEl = $(el).find('.elementor-toggle-title');
        const id = $(el).find('.elementor-tab-title').attr('id');
        if (titleEl.length && id) {
          const text = titleEl.text().trim();
          poaUrlMap[text] = `https://poa.gr/index.php/programma/#${id}`;
        }
      });
    } catch (e) {
      console.error('Error parsing POA HTML for IDs:', e.message);
    }
  }

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
        url: matchTitleToUrl(title.trim(), poaUrlMap, 'https://poa.gr/index.php/programma/'),
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
        url: matchTitleToUrl(title.trim(), poaUrlMap, 'https://poa.gr/index.php/programma/'),
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

  // Build URL Map from WooCommerce catalog raw HTML
  const urlMap = {};
  const htmlPath = path.join(INPUT_DIR, 'eosh_gr_wp-product-category-greek-mountains-climbs.html');
  const defaultUrl = 'https://eosh.gr/wp/product-category/greek-mountains-climbs/';

  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('.product').each((i, el) => {
        const titleText = $(el).find('.woocommerce-loop-product__title').text().trim();
        const href = $(el).find('a.woocommerce-LoopProduct-link').attr('href');
        if (titleText && href) {
          urlMap[titleText] = href;
        }
      });
    } catch (e) {
      console.error('Failed to parse EOS Hlioupolis product catalog:', e.message);
    }
  }

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
        url: matchTitleToUrl(title.trim(), urlMap, defaultUrl),
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

  // Build URL Map from Elementor article blocks in raw HTML
  const urlMap = {};
  const htmlPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.html');
  const defaultUrl = 'https://www.foni.org.gr/category/ekdromes/';

  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('article').each((i, el) => {
        const titleLink = $(el).find('.elementor-post__title a');
        const titleText = titleLink.text().trim();
        const href = titleLink.attr('href');
        if (titleText && href) {
          urlMap[titleText] = href;
        }
      });
    } catch (e) {
      console.error('Failed to parse FONI article list:', e.message);
    }
  }

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
          url: matchTitleToUrl(title, urlMap, defaultUrl),
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

  // Build URL Map from JSON-LD in raw HTML
  const urlMap = {};
  const htmlPath = path.join(INPUT_DIR, 'eposfilis_gr_events-category-_ce_b7_ce_bc_ce_b5_cf_81_ce_bf_ce_bb_cf_8c_ce_b3_ce_b9_ce_bf.html');
  const defaultUrl = 'https://eposfilis.gr/events/category/%ce%b7%ce%bc%ce%b5%cf%81%ce%bf%ce%bb%cf%8c%ce%b3%ce%b9%ce%bf/';

  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const json = JSON.parse($(el).html());
          const jsonArray = Array.isArray(json) ? json : [json];
          for (const item of jsonArray) {
            const events = item['@type'] === 'Event' ? [item] : (item['@graph'] ? item['@graph'].filter(x => x['@type'] === 'Event') : []);
            for (const ev of events) {
              if (ev.name && ev.url) {
                urlMap[ev.name] = ev.url;
              }
            }
          }
        } catch (e) {
          // ignore individual json parse errors
        }
      });
    } catch (e) {
      console.error('Failed to parse EPOS Filis JSON-LD:', e.message);
    }
  }

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
        url: matchTitleToUrl(title, urlMap, defaultUrl),
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
        url: matchTitleToUrl(name, urlMap, defaultUrl),
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
        url: matchTitleToUrl(title, urlMap, defaultUrl),
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
  const statusLogs = [];

  const fetchReportPath = path.join(INPUT_DIR, 'fetch-status.json');
  let fetchReport = null;
  if (fs.existsSync(fetchReportPath)) {
    try {
      fetchReport = JSON.parse(fs.readFileSync(fetchReportPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse fetch-status.json', e.message);
    }
  }

  const CLUB_URLS = {
    'ΕΟΣ Αχαρνών': ['https://eosacharnon.xmiddleware.com/el'],
    'ΑΟΣ': [
      'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/',
      'https://aos.gr/programma-exormiseon-ianouarios-2026-septemvrios-2026/'
    ],
    'ΠΟΑ': ['https://poa.gr/index.php/programma/'],
    'ΕΟΣ Αθηνών': [
      'https://www.eosathinon.gr/anavaseis/programma/',
      'https://www.eosathinon.gr/anavaseis/anavaseis-exoterikoy/'
    ],
    'ΕΟΣ Ηλιούπολης': ['https://eosh.gr/wp/product-category/greek-mountains-climbs/'],
    'ΦΟΝΙ': ['https://www.foni.org.gr/category/ekdromes/'],
    'ΕΠΟΣ Φυλής': ['https://eposfilis.gr/events/category/%ce%b7%ce%bc%ce%b5%cf%81%ce%bf%ce%bb%cf%8c%ce%b3%ce%b9%ce%bf/']
  };

  const addLog = (club, status, countOrError) => {
    const logEntry = {
      club,
      status,
      details: status === 'success' ? `Parsed ${countOrError} events` : `Error: ${countOrError}`
    };

    if (fetchReport && CLUB_URLS[club]) {
      logEntry.fetch = CLUB_URLS[club].map(url => {
        const urlLog = fetchReport[url];
        return urlLog ? { url, ...urlLog } : { url, success: false, status: 'Not fetched', code: 0, size: 0 };
      });
    }

    statusLogs.push(logEntry);
  };

  try {
    const acharnon = parseEosAcharnon();
    console.log(`Parsed ${acharnon.length} events from EOS Acharnon`);
    allEvents = allEvents.concat(acharnon);
    addLog('ΕΟΣ Αχαρνών', 'success', acharnon.length);
  } catch (e) {
    console.error('Error parsing EOS Acharnon:', e.message);
    addLog('ΕΟΣ Αχαρνών', 'error', e.message);
  }

  try {
    const aos = parseAos();
    console.log(`Parsed ${aos.length} events from AOS`);
    allEvents = allEvents.concat(aos);
    addLog('ΑΟΣ', 'success', aos.length);
  } catch (e) {
    console.error('Error parsing AOS:', e.message);
    addLog('ΑΟΣ', 'error', e.message);
  }

  try {
    const poa = parsePoa();
    console.log(`Parsed ${poa.length} events from POA`);
    allEvents = allEvents.concat(poa);
    addLog('ΠΟΑ', 'success', poa.length);
  } catch (e) {
    console.error('Error parsing POA:', e.message);
    addLog('ΠΟΑ', 'error', e.message);
  }

  try {
    const athinon = parseEosAthinon();
    console.log(`Parsed ${athinon.length} events from EOS Athinon`);
    allEvents = allEvents.concat(athinon);
    addLog('ΕΟΣ Αθηνών', 'success', athinon.length);
  } catch (e) {
    console.error('Error parsing EOS Athinon:', e.message);
    addLog('ΕΟΣ Αθηνών', 'error', e.message);
  }

  try {
    const hlioupolis = parseEosHalioupolis();
    console.log(`Parsed ${hlioupolis.length} events from EOS Hlioupolis`);
    allEvents = allEvents.concat(hlioupolis);
    addLog('ΕΟΣ Ηλιούπολης', 'success', hlioupolis.length);
  } catch (e) {
    console.error('Error parsing EOS Hlioupolis:', e.message);
    addLog('ΕΟΣ Ηλιούπολης', 'error', e.message);
  }

  try {
    const foni = parseFoni();
    console.log(`Parsed ${foni.length} events from FONI`);
    allEvents = allEvents.concat(foni);
    addLog('ΦΟΝΙ', 'success', foni.length);
  } catch (e) {
    console.error('Error parsing FONI:', e.message);
    addLog('ΦΟΝΙ', 'error', e.message);
  }

  try {
    const filis = parseEposFilis();
    console.log(`Parsed ${filis.length} events from EPOS Filis`);
    allEvents = allEvents.concat(filis);
    addLog('ΕΠΟΣ Φυλής', 'success', filis.length);
  } catch (e) {
    console.error('Error parsing EPOS Filis:', e.message);
    addLog('ΕΠΟΣ Φυλής', 'error', e.message);
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

  // Write execution status logs
  const statusFile = path.join(path.dirname(OUTPUT_FILE), 'status.json');
  fs.writeFileSync(statusFile, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    logs: statusLogs
  }, null, 2), 'utf-8');
  console.log(`Saved execution status logs to ${statusFile}`);
}

main();
