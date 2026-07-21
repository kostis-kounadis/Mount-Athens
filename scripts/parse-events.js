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
  'σεπ': '09', 'σεπτ': '09', 'σεπτεμβριος': '09', 'σεπτεμβριου': '09', 'σεπτεμβρίου': '09',
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
  const fallbackUrl = defaultUrl.includes('#') ? defaultUrl : defaultUrl + '#:~:text=' + encodeURIComponent(parsedTitle.replace(/\s+/g, ' ').trim());
  
  if (parsedWords.length === 0) return fallbackUrl;

  let bestUrl = fallbackUrl;
  let maxMatchRatio = 0.6; // Threshold: at least 60% overlap of the larger set of words

  for (const [key, url] of Object.entries(urlMap)) {
    const keyWords = getSignificantWords(key);
    if (keyWords.length === 0) continue;

    // Count overlap
    const overlap = parsedWords.filter(w => keyWords.includes(w));
    const ratio = overlap.length / Math.max(parsedWords.length, keyWords.length);

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

  const aosTxtFiles = [
    { file: 'aos_gr_trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis.txt', defaultUrl: 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/' },
    { file: 'aos_gr_programma-exormiseon-ianouarios-2026-septemvrios-2026.txt', defaultUrl: 'https://aos.gr/programma-exormiseon-ianouarios-2026-septemvrios-2026/' }
  ];

  const events = [];

  for (const src of aosTxtFiles) {
    const txtPath = path.join(INPUT_DIR, src.file);
    if (!fs.existsSync(txtPath)) continue;
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');

    let currentMonthHeader = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check for month header like "Ιουνιος 2026"
      if (/^[Α-Ωα-ωίϊΐόάέύώήώ]+\s+\d{4}$/.test(line) && !line.includes('Δηλώσεις')) {
        currentMonthHeader = line;
        continue;
      }

      // Numeric formats
      // 1: 31/01 - 01/02/26 or 21/08/26 - 1/9/2026
      const numCrossMonth = /^(\d+)\/(\d+)(?:\/\d+)?\s*[-–—]\s*(\d+)\/(\d+)(?:\/(\d+))?\s*[-–—]?\s*(.+)/.exec(line);
      // 2: 03-05/01/26 or 14-15/02 or 21-22-23/02
      const numRangeMonth = /^(\d+)(?:-\d+)*-(\d+)\/(\d+)(?:\/(\d+))?\s*[-–—]?\s*(.+)/.exec(line);
      // 3: 11/01/26 or 19/4
      const numSingleMonth = /^(\d+)\/(\d+)(?:\/(\d+))?\s*[-–—]?\s*(.+)/.exec(line);

      let pStartDay, pEndDay, pStartMonth, pEndMonth, pYear, pTitle;

      if (numCrossMonth) {
        pStartDay = numCrossMonth[1];
        pStartMonth = numCrossMonth[2];
        pEndDay = numCrossMonth[3];
        pEndMonth = numCrossMonth[4];
        pYear = numCrossMonth[5];
        pTitle = numCrossMonth[6];
      } else if (numRangeMonth) {
        pStartDay = numRangeMonth[1];
        pEndDay = numRangeMonth[2];
        pStartMonth = numRangeMonth[3];
        pEndMonth = numRangeMonth[3];
        pYear = numRangeMonth[4];
        pTitle = numRangeMonth[5];
      } else if (numSingleMonth) {
        pStartDay = numSingleMonth[1];
        pEndDay = numSingleMonth[1];
        pStartMonth = numSingleMonth[2];
        pEndMonth = numSingleMonth[2];
        pYear = numSingleMonth[3];
        pTitle = numSingleMonth[4];
      }

      if (pStartDay) {
        const yStr = pYear ? (pYear.length === 2 ? '20' + pYear : pYear) : '2026';
        const sDate = `${yStr}-${pStartMonth.padStart(2, '0')}-${pStartDay.padStart(2, '0')}`;
        
        let eYStr = yStr;
        if (parseInt(pEndMonth) < parseInt(pStartMonth)) {
            eYStr = String(parseInt(yStr) + 1);
        }
        const eDate = `${eYStr}-${pEndMonth.padStart(2, '0')}-${pEndDay.padStart(2, '0')}`;
        
        const dDate = pStartDay !== pEndDay ? `${parseInt(pStartDay)}/${parseInt(pStartMonth)} - ${parseInt(pEndDay)}/${parseInt(pEndMonth)}` : `${parseInt(pStartDay)}/${parseInt(pStartMonth)}`;

        let cleanTitle = pTitle.split('Λεπτομέρειες')[0].trim();
        cleanTitle = cleanTitle.split('Αρχηγοί')[0].trim();
        if (cleanTitle) {
           events.push({
             startDate: sDate,
             endDate: eDate,
             displayDate: dDate,
             title: cleanTitle,
             club: 'ΑΟΣ',
             url: matchTitleToUrl(cleanTitle, urlMap, src.defaultUrl),
             difficulty: ''
           });
        }
        continue;
      }

      // Existing String formats
      const isRange = /^(\d+)-(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
      const isSingle = /^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
      const isMultiMonth = /^Παρασκευή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+έως\s+Κυριακή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);
      const isMultiMonthSep = /^Παρασκευή\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+έως\s+Τρίτη\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})/i.test(line);

      if (isRange || isSingle || isMultiMonth || isMultiMonthSep) {
        const dateStr = line;
        let title = '';
        if (lines[i+1]) title = lines[i+1].trim();
        
        let parsed = parseDateRange(dateStr);
        
        if (parsed) {
          events.push({
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            displayDate: parsed.displayDate,
            title,
            club: 'ΑΟΣ',
            url: matchTitleToUrl(title, urlMap, src.defaultUrl),
            difficulty: ''
          });
        }
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
  const htmlPath = path.join(INPUT_DIR, 'poa_gr_index_php-programma.html');
  if (!fs.existsSync(htmlPath)) return [];

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const events = [];

  let currentMonth = '';
  let currentYear = '2026';
  let currentMonthStr = '';

  const GREEK_MONTHS_MAP = {
    'ιανουαριος': '01', 'φεβρουαριος': '02', 'μαρτιος': '03', 'απριλιος': '04', 'μαιος': '05', 'ιουνιος': '06',
    'ιουλιος': '07', 'αυγουστος': '08', 'σεπτεμβριος': '09', 'οκτωβριος': '10', 'νοεμβριος': '11', 'δεκεμβριος': '12'
  };

  $('h3.elementor-heading-title, .elementor-toggle-item, .elementor-accordion-item').each((i, el) => {
    const $el = $(el);
    const tagName = el.tagName.toLowerCase();

    if (tagName === 'h3') {
      const text = $el.text().trim().replace(/\s+/g, ' ');
      // Match month name and 4 digit year
      const match = text.match(/^([a-zA-ZΑ-Ωα-ωίϊΐόάέύώήώ\s]+)\s+(\d{4})$/i);
      if (match) {
        const monthName = stripGreekAccents(match[1]).trim().toLowerCase().replace(/\s+/g, '');
        if (GREEK_MONTHS_MAP[monthName]) {
          currentMonth = GREEK_MONTHS_MAP[monthName];
          currentYear = match[2];
          currentMonthStr = text;
        }
      }
    } else {
      if (!currentMonth) return;

      const titleEl = $el.find('.elementor-toggle-title, .elementor-accordion-title');
      const tabTitleEl = $el.find('.elementor-tab-title');
      const id = tabTitleEl.attr('id');
      const fullTitleText = titleEl.text().trim().replace(/\s+/g, ' ');

      // Format 1: Cross-month range "30-31/12 – 1/1 Title"
      const crossMonthMatch = fullTitleText.match(/^(\d+(?:-\d+)?)\s*\/\s*(\d+)\s*[-–—]\s*(\d+(?:-\d+)?)\s*\/\s*(\d+)\s*(.+)$/);
      if (crossMonthMatch) {
        const startDayPart = crossMonthMatch[1];
        const startMonth = crossMonthMatch[2].padStart(2, '0');
        const endDayPart = crossMonthMatch[3];
        const endMonth = crossMonthMatch[4].padStart(2, '0');
        const rest = crossMonthMatch[5].trim();

        // Skip itinerary lines
        const cleanRest = stripGreekAccents(rest);
        const isItinerary = /^(δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/i.test(cleanRest);
        if (isItinerary) return;

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
          url: title ? `https://poa.gr/index.php/programma/#:~:text=${encodeURIComponent(title.replace(/\s+/g, ' ').trim())}` : 'https://poa.gr/index.php/programma/',
          difficulty
        });
        return;
      }

      // Format 2: Single-month range or single date: "23 – 30/6 Title"
      const singleMonthMatch = fullTitleText.match(/^(\d+(?:\s*[-–—]\s*\d+)?)\s*\/\s*(\d+)\s+(.+)$/);
      if (singleMonthMatch) {
        const dayPart = singleMonthMatch[1];
        const monthNum = singleMonthMatch[2].padStart(2, '0');
        const rest = singleMonthMatch[3].trim();

        // Skip itinerary lines
        const cleanRest = stripGreekAccents(rest);
        const isItinerary = /^(δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/i.test(cleanRest);
        if (isItinerary) return;

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
          url: title ? `https://poa.gr/index.php/programma/#:~:text=${encodeURIComponent(title.replace(/\s+/g, ' ').trim())}` : 'https://poa.gr/index.php/programma/',
          difficulty
        });
      }
    }
  });

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
function parseEosAthinonExoterikoy() {
  const htmlPath = path.join(INPUT_DIR, 'eosathinon_gr_anavaseis-anavaseis-exoterikoy.html');
  if (!fs.existsSync(htmlPath)) return [];

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const events = [];

  const GREEK_MONTHS_MAP = {
    'ιανουαριος': '01', 'φεβρουαριος': '02', 'μαρτιος': '03', 'απριλιος': '04', 'μαιος': '05', 'ιουνιος': '06',
    'ιουλιος': '07', 'αυγουστος': '08', 'σεπτεμβριος': '09', 'οκτωβριος': '10', 'νοεμβριος': '11', 'δεκεμβριος': '12',
    'ιανουαριου': '01', 'φεβρουαριου': '02', 'μαρτιου': '03', 'απριλιου': '04', 'μαιου': '05', 'ιουνιου': '06',
    'ιουλιου': '07', 'αυγουστου': '08', 'σεπτεμβριου': '09', 'οκτωβριου': '10', 'νοεμβριου': '11', 'δεκεμβριου': '12'
  };

  const parseMonth = (mStr) => {
    if (!mStr) return null;
    const clean = stripGreekAccents(mStr).trim().toLowerCase();
    return GREEK_MONTHS_MAP[clean] || null;
  };

  $('.elementor-widget-text-editor').each((index, el) => {
    const $el = $(el);
    const pTags = $el.find('p');
    if (pTags.length === 0) return;

    const firstPText = $(pTags[0]).text().trim().replace(/\s+/g, ' ');
    if (firstPText.length < 5) return;

    const fullText = $el.text().replace(/\s+/g, ' ');
    const yearMatch = fullText.match(/(202[5-9])/);
    if (!yearMatch) return;
    const year = yearMatch[1];

    let startDate = '';
    let endDate = '';
    let displayDate = '';

    for (let j = 0; j < Math.min(pTags.length, 5); j++) {
      const pText = $(pTags[j]).text().trim().replace(/\s+/g, ' ');
      
      // Normalize string: strip accents and make lowercase
      let cleanText = stripGreekAccents(pText).toLowerCase();
      
      // Remove week days, holidays and their common abbreviations (ORDER MATTERS: long phrases first!)
      cleanText = cleanText
        .replace(/(?:megalo sabbato|μεγαλο σαββατο|megali paraskeyi|μεγαλη παρασκευη)/g, '')
        .replace(/(?:δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/g, '')
        .replace(/(?:δευτ|τρι|τετ|πεμ|παρ|σαβ|κυρ)\.?/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Pattern 1: "απο [startDay] έως [endDay] [endMonth]"
      const rangeMatch = cleanText.match(/απο\s+(\d+)\s*([a-zα-ω]+)?\s*εως\s+(\d+)\s+([a-zα-ω]+)/i);
      if (rangeMatch) {
        const startDay = rangeMatch[1].padStart(2, '0');
        const startMonthStr = rangeMatch[2];
        const endDay = rangeMatch[3].padStart(2, '0');
        const endMonthStr = rangeMatch[4];
        
        const endMonthNum = parseMonth(endMonthStr);
        const startMonthNum = parseMonth(startMonthStr) || endMonthNum;
        
        if (endMonthNum && startMonthNum) {
          startDate = `${year}-${startMonthNum}-${startDay}`;
          let endYear = year;
          if (parseInt(endMonthNum) < parseInt(startMonthNum)) {
            endYear = String(parseInt(year) + 1);
          }
          endDate = `${endYear}-${endMonthNum}-${endDay}`;
          displayDate = `${parseInt(startDay)}/${parseInt(startMonthNum)} - ${parseInt(endDay)}/${parseInt(endMonthNum)}`;
          break;
        }
      }

      // Pattern 2: "[startDay] έως [endDay] [endMonth]" (no "απο")
      const rangeMatchNoApo = cleanText.match(/^(\d+)\s*([a-zα-ω]+)?\s*εως\s+(\d+)\s+([a-zα-ω]+)/i);
      if (rangeMatchNoApo) {
        const startDay = rangeMatchNoApo[1].padStart(2, '0');
        const startMonthStr = rangeMatchNoApo[2];
        const endDay = rangeMatchNoApo[3].padStart(2, '0');
        const endMonthStr = rangeMatchNoApo[4];
        
        const endMonthNum = parseMonth(endMonthStr);
        const startMonthNum = parseMonth(startMonthStr) || endMonthNum;
        
        if (endMonthNum && startMonthNum) {
          startDate = `${year}-${startMonthNum}-${startDay}`;
          let endYear = year;
          if (parseInt(endMonthNum) < parseInt(startMonthNum)) {
            endYear = String(parseInt(year) + 1);
          }
          endDate = `${endYear}-${endMonthNum}-${endDay}`;
          displayDate = `${parseInt(startDay)}/${parseInt(startMonthNum)} - ${parseInt(endDay)}/${parseInt(endMonthNum)}`;
          break;
        }
      }

      // Pattern 3: "αναχωρηση [startDay]/[startMonth], επιστροφη [endDay]/[endMonth]"
      const altRangeMatch = cleanText.match(/αναχωρηση\s+(\d+)\/(\d+)\s*,\s*επιστροφη\s+(\d+)\s*[-–—]\s*(\d+)\/(\d+)/i);
      if (altRangeMatch) {
        const startDay = altRangeMatch[1].padStart(2, '0');
        const startMonth = altRangeMatch[2].padStart(2, '0');
        const endDay = altRangeMatch[4].padStart(2, '0');
        const endMonth = altRangeMatch[5].padStart(2, '0');
        
        startDate = `${year}-${startMonth}-${startDay}`;
        let endYear = year;
        if (parseInt(endMonth) < parseInt(startMonth)) {
          endYear = String(parseInt(year) + 1);
        }
        endDate = `${endYear}-${endMonth}-${endDay}`;
        displayDate = `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`;
        break;
      }
    }

    if (!startDate) return;

    // Extract Title from the first paragraph
    let title = firstPText;
    const stripPattern = new RegExp(`\\s*[-–—]?\\s*(?:[A-Za-zΑ-Ωα-ωίϊΐόάέύώήώ]+)?\\s*${year}`, 'i');
    title = title.replace(stripPattern, '').trim();
    title = title.replace(/\s*[-–—]\s*$/, '').trim();

    // Try to find a PDF link inside the widget
    let pdfUrl = 'https://www.eosathinon.gr/anavaseis/anavaseis-exoterikoy/';
    const aTags = $el.find('a');
    aTags.each((j, aEl) => {
      const href = $(aEl).attr('href');
      if (href && href.endsWith('.pdf')) {
        pdfUrl = href;
      }
    });

    events.push({
      startDate,
      endDate,
      displayDate,
      title,
      club: 'ΕΟΣ Αθηνών',
      url: pdfUrl,
      difficulty: ''
    });
  });

  return events;
}

function parseEosAthinon() {
  const txtPath = path.join(INPUT_DIR, 'eosathinon_gr_anavaseis-programma.txt');
  let events = [];

  if (fs.existsSync(txtPath)) {
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');
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
        // Remove trailing date-like fragments that got left behind (e.g. '2/' or '2/10')
        titlePart = titlePart.replace(/\d+\/\d*\s*$/, '').trim();

        // Parse datePart
        const parsed = parseDateRange(datePart, currentYear);

        if (parsed) {
          const monthStr = parsed.startDate.split('-')[1];
          const yearStr = parsed.startDate.split('-')[0].slice(-2);
          const accId = `${monthStr}-${yearStr}`;
          
          events.push({
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            displayDate: parsed.displayDate,
            title: titlePart,
            club: 'ΕΟΣ Αθηνών',
            url: titlePart ? `https://www.eosathinon.gr/anavaseis/programma/#${accId}:~:text=${encodeURIComponent(titlePart)}` : 'https://www.eosathinon.gr/anavaseis/programma/',
            difficulty: ''
          });
        }
      }
    }
  }

  // Combine with climbs abroad
  try {
    const exoterikoy = parseEosAthinonExoterikoy();
    events = events.concat(exoterikoy);
  } catch (e) {
    console.error('Error parsing EOS Athinon Exoterikoy:', e.message);
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
  let events = [];

  const apiPath = path.join(INPUT_DIR, 'eosh_gr_api-trips.html');
  if (!fs.existsSync(apiPath)) return events;

  try {
    const rawData = fs.readFileSync(apiPath, 'utf-8');
    const json = JSON.parse(rawData);

    if (!json.trips || !Array.isArray(json.trips)) {
      return events;
    }

    const defaultUrl = 'https://eosh.gr/expeditions';

    for (const trip of json.trips) {
      if (!trip.title_gr) continue;
      const line = trip.title_gr.trim();

      // Format: "26 Ιουλ- 3 Αυγ 2026: Βόρεια Σουηδία (Kungsleden trail)"
      const crossMatch = line.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s*[-–—]\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4}):\s*(.+)$/i);
      if (crossMatch) {
        const startDay = crossMatch[1];
        const startMonthStr = crossMatch[2];
        const endDay = crossMatch[3];
        const endMonthStr = crossMatch[4];
        const year = crossMatch[5];
        const title = crossMatch[6];

        const startMonthNum = parseGreekMonth(startMonthStr) || '07';
        const endMonthNum = parseGreekMonth(endMonthStr) || '08';

        const startDate = `${year}-${startMonthNum}-${startDay.padStart(2, '0')}`;
        const endDate = `${year}-${endMonthNum}-${endDay.padStart(2, '0')}`;
        const displayDate = `${parseInt(startDay)}/${parseInt(startMonthNum)} - ${parseInt(endDay)}/${parseInt(endMonthNum)}`;

        events.push({
          startDate,
          endDate,
          displayDate,
          title: title.trim(),
          club: 'ΕΟΣ Ηλιούπολης',
          url: trip.slug ? `https://eosh.gr/expeditions/${trip.slug}` : defaultUrl,
          difficulty: ''
        });
        continue;
      }

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
          url: trip.slug ? `https://eosh.gr/expeditions/${trip.slug}` : defaultUrl,
          difficulty: ''
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse EOS Hlioupolis API payload:', e.message);
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
// PARSER: ΦΟΠ (Text-based)
// ----------------------------------------------------
function parseFop() {
  const txtPath = path.join(INPUT_DIR, 'fop_gr.txt');
  if (!fs.existsSync(txtPath)) return [];

  const content = fs.readFileSync(txtPath, 'utf-8');
  const lines = content.split('\n');
  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Match patterns like "7/6/2026 ΦΑΡΑΓΓΙ ΛΟΥΣΙΟΥ..." or "27-28/6/2026..."
    const match = line.match(/^(\d+(?:-\d+)?)\/(\d+)\/(\d{4})\s+(.+)$/);
    if (match) {
      const dayPart = match[1];
      const month = match[2].padStart(2, '0');
      const year = match[3];
      const rest = match[4].trim();

      // Extract title by removing day name and anything after it
      let title = rest;
      const dayMatch = rest.match(/(.+?)(?:ΔΕΥΤΕΡΑ|ΤΡΙΤΗ|ΤΕΤΑΡΤΗ|ΠΕΜΠΤΗ|ΠΑΡΑΣΚΕΥΗ|ΣΑΒΒΑΤΟ|ΚΥΡΙΑΚΗ)/i);
      if (dayMatch) {
        title = dayMatch[1].trim();
      }

      // Look at next lines for difficulty (ΒΔ)
      let difficulty = '';
      for (let j = 1; j <= 3; j++) {
        if (i + j < lines.length) {
          const nextLine = lines[i + j].trim();
          const bdMatch = nextLine.match(/ΒΔ:\s*([\d\w+]+)/i);
          if (bdMatch) {
            difficulty = 'ΒΔ ' + bdMatch[1].trim();
            break;
          }
        }
      }

      // Handle date range
      let startDate = '';
      let endDate = '';
      let displayDate = '';

      if (dayPart.includes('-')) {
        const [startDay, endDay] = dayPart.split('-');
        startDate = `${year}-${month}-${startDay.padStart(2, '0')}`;
        endDate = `${year}-${month}-${endDay.padStart(2, '0')}`;
        displayDate = `${startDay}-${endDay}/${parseInt(month)}`;
      } else {
        startDate = `${year}-${month}-${dayPart.padStart(2, '0')}`;
        endDate = `${year}-${month}-${dayPart.padStart(2, '0')}`;
        displayDate = `${dayPart}/${parseInt(month)}`;
      }

      events.push({
        startDate,
        endDate,
        displayDate,
        title: title.replace(/\s+/g, ' ').trim(),
        club: 'ΦΟΠ',
        url: 'https://fop.gr/#:~:text=' + encodeURIComponent(title.replace(/\s+/g, ' ').trim()),
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

  let CLUB_URLS = {};
  const configPath = path.join(INPUT_DIR, 'link-config.json');
  if (fs.existsSync(configPath)) {
    try {
      CLUB_URLS = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error('Error reading link-config.json:', e.message);
    }
  }

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

  try {
    const fop = parseFop();
    console.log(`Parsed ${fop.length} events from FOP`);
    allEvents = allEvents.concat(fop);
    addLog('ΦΟΠ', 'success', fop.length);
  } catch (e) {
    console.error('Error parsing FOP:', e.message);
    addLog('ΦΟΠ', 'error', e.message);
  }

  // Filter out invalid dates, and only include events from TODAY onwards
  // Since we also want to display events starting in June 2026, let's filter correctly
  allEvents = allEvents.filter(e => {
    if (!e.startDate || e.startDate === 'NaN-NaN-NaN') return false;
    const evDate = new Date(e.startDate);
    // Keep only future/current events (from TODAY onwards)
    return evDate >= TODAY;
  });

  // Global Smarter Deduplication
  const dedupedEvents = [];
  for (const ev of allEvents) {
    const duplicate = dedupedEvents.find(u => 
      u.club === ev.club && 
      u.startDate === ev.startDate && 
      u.endDate === ev.endDate
    );

    if (duplicate) {
      const t1 = stripGreekAccents(ev.title).toLowerCase().trim();
      const t2 = stripGreekAccents(duplicate.title).toLowerCase().trim();
      
      const words1 = getSignificantWords(ev.title);
      const words2 = getSignificantWords(duplicate.title);
      const overlap = words1.filter(w => words2.includes(w)).length;
      
      // If one string includes the other, or they share a significant word overlap (>= 1 word if short, otherwise 40%+)
      const isSubset = t1.includes(t2) || t2.includes(t1);
      const isWordMatch = overlap >= 1 && (overlap / Math.min(words1.length, words2.length)) >= 0.4;

      if (isSubset || isWordMatch) {
        // Merge them: prefer the shorter title if one is a subset (usually the longer is messy), otherwise prefer longer
        if (isSubset) {
          if (ev.title.length < duplicate.title.length) duplicate.title = ev.title;
        } else {
          if (ev.title.length > duplicate.title.length) duplicate.title = ev.title;
        }
        // Keep the better URL (if one has a real URL vs a text fragment fallback)
        const evHasFrag = ev.url.includes('#:~:text=');
        const dupHasFrag = duplicate.url.includes('#:~:text=');
        if (!evHasFrag && dupHasFrag) {
          duplicate.url = ev.url;
        } else if (evHasFrag && dupHasFrag && ev.url.length > duplicate.url.length) {
          duplicate.url = ev.url;
        }
        continue; // Skip adding this event since we merged it
      }
    }
    dedupedEvents.push(ev);
  }
  allEvents = dedupedEvents;

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
