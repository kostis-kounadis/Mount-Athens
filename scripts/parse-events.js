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
  if (!str) return '';
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

const MONTH_PREFIXES = [
  { month: '01', prefixes: ['ιαν', 'γεν'] },
  { month: '02', prefixes: ['φεβ', 'φλεβ'] },
  { month: '03', prefixes: ['μαρ'] },
  { month: '04', prefixes: ['απρ'] },
  { month: '05', prefixes: ['μαι', 'μαϊ', 'μαη'] },
  { month: '06', prefixes: ['ιουν'] },
  { month: '07', prefixes: ['ιουλ'] },
  { month: '08', prefixes: ['αυγ'] },
  { month: '09', prefixes: ['σεπ', 'σεπτ'] },
  { month: '10', prefixes: ['οκτ', 'οκτωβ'] },
  { month: '11', prefixes: ['νοε', 'νοεμ', 'νοεμβ'] },
  { month: '12', prefixes: ['δεκ', 'δεκεμ', 'δεκεμβ'] }
];

function parseGreekMonth(monthStr) {
  if (!monthStr) return null;
  const clean = stripGreekAccents(monthStr).replace(/[^a-zα-ω]/g, '').trim();
  if (!clean) return null;

  if (MONTH_MAP[clean]) return MONTH_MAP[clean];

  for (const entry of MONTH_PREFIXES) {
    for (const pref of entry.prefixes) {
      if (clean.startsWith(pref)) {
        return entry.month;
      }
    }
  }

  return null;
}

function parseEnglishMonth(monthStr) {
  if (!monthStr) return null;
  const clean = monthStr.toLowerCase().replace(/[^a-z]/g, '').trim();
  return ENGLISH_MONTHS[clean] || null;
}

/**
 * Universal helper to resolve event year.
 * Protects against hardcoded year bugs & distinguishes 2 Januaries (past vs upcoming).
 * 1. If explicit year is given (e.g. 2026, 2027, 26, 27), use it.
 * 2. If contextYear is given (e.g. from an enclosing section header "Ιανουάριος 2027"), use it.
 * 3. Otherwise, relative to current Athens date:
 *    - If event month is before current month (e.g. Month 1 in Month 9), it belongs to upcoming year (currentAthensYear + 1).
 *    - If event month is >= current month, it belongs to current year (currentAthensYear).
 */
function resolveEventYear(eventMonth, explicitYear = null, contextYear = null) {
  if (explicitYear) {
    let y = String(explicitYear).trim();
    if (y.length === 2) return '20' + y;
    if (y.length === 4) return y;
  }
  if (contextYear) {
    let cy = String(contextYear).trim();
    if (cy.length === 2) return '20' + cy;
    if (cy.length === 4) return cy;
  }
  const currentAthensYear = TODAY.getFullYear();
  const currentAthensMonth = TODAY.getMonth() + 1; // 1-12
  const m = parseInt(eventMonth, 10);
  if (!isNaN(m)) {
    if (m < currentAthensMonth) {
      return String(currentAthensYear + 1);
    }
    return String(currentAthensYear);
  }
  return String(currentAthensYear);
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

function parseDateRange(dateText, contextYear = null) {
  if (!dateText) return null;

  // Normalize and clean day names
  let cleanText = dateText
    .replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Format: "18.09.- 20.09.2026" or "18.09 - 20.09.2026" or "31.10.- 01.11.2026"
  const dotCrossMonthMatch = cleanText.match(/(\d{1,2})[\.\/](\d{1,2})\.?\s*[-–—]\s*(\d{1,2})[\.\/](\d{1,2})(?:[\.\/](\d{2,4}))?/);
  if (dotCrossMonthMatch) {
    const startDay = dotCrossMonthMatch[1].padStart(2, '0');
    const startMonth = dotCrossMonthMatch[2].padStart(2, '0');
    const endDay = dotCrossMonthMatch[3].padStart(2, '0');
    const endMonth = dotCrossMonthMatch[4].padStart(2, '0');
    const explicitYear = dotCrossMonthMatch[5] || null;

    const startYear = resolveEventYear(startMonth, explicitYear, contextYear);
    let endYear = resolveEventYear(endMonth, explicitYear, contextYear);
    if (parseInt(endMonth) < parseInt(startMonth)) {
      endYear = String(parseInt(startYear) + 1);
    }

    return {
      startDate: `${startYear}-${startMonth}-${startDay}`,
      endDate: `${endYear}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "27-28.09.2026" or "27-28.9.2026"
  const dotSameMonthMatch = cleanText.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})[\.\/](\d{1,2})(?:[\.\/](\d{2,4}))?/);
  if (dotSameMonthMatch) {
    const startDay = dotSameMonthMatch[1].padStart(2, '0');
    const endDay = dotSameMonthMatch[2].padStart(2, '0');
    const month = dotSameMonthMatch[3].padStart(2, '0');
    const explicitYear = dotSameMonthMatch[4] || null;
    const year = resolveEventYear(month, explicitYear, contextYear);

    return {
      startDate: `${year}-${month}-${startDay}`,
      endDate: `${year}-${month}-${endDay}`,
      displayDate: `${parseInt(startDay)}-${parseInt(endDay)}/${parseInt(month)}`
    };
  }

  // Format: "27/09/2026" or "27.09.2026" or "27/09"
  const dotSingleMatch = cleanText.match(/(\d{1,2})[\.\/](\d{1,2})(?:[\.\/](\d{2,4}))?/);
  if (dotSingleMatch) {
    const day = dotSingleMatch[1].padStart(2, '0');
    const month = dotSingleMatch[2].padStart(2, '0');
    const explicitYear = dotSingleMatch[3] || null;
    const year = resolveEventYear(month, explicitYear, contextYear);

    return {
      startDate: `${year}-${month}-${day}`,
      endDate: `${year}-${month}-${day}`,
      displayDate: `${parseInt(day)}/${parseInt(month)}`
    };
  }

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
  const rangeTwoMonthsMatch = cleanText.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s*(?:[-–—]|έως|εως)\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i);
  if (rangeTwoMonthsMatch) {
    const startDay = rangeTwoMonthsMatch[1].padStart(2, '0');
    const startMonthStr = rangeTwoMonthsMatch[2];
    const endDay = rangeTwoMonthsMatch[3].padStart(2, '0');
    const endMonthStr = rangeTwoMonthsMatch[4];
    const explicitYear = rangeTwoMonthsMatch[5] || null;

    const startMonth = parseGreekMonth(startMonthStr) || '06';
    const endMonth = parseGreekMonth(endMonthStr) || '06';
    const startYear = resolveEventYear(startMonth, explicitYear, contextYear);
    let endYear = resolveEventYear(endMonth, explicitYear, contextYear);
    if (parseInt(endMonth) < parseInt(startMonth)) {
      endYear = String(parseInt(startYear) + 1);
    }

    return {
      startDate: `${startYear}-${startMonth}-${startDay}`,
      endDate: `${endYear}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "12-14 Ιουνίου 2026" or "27-28 Ιουν"
  const rangeMatch = cleanText.match(/^(\d+)\s*[-–—]\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i);
  if (rangeMatch) {
    const startDay = rangeMatch[1].padStart(2, '0');
    const endDay = rangeMatch[2].padStart(2, '0');
    const monthStr = rangeMatch[3];
    const explicitYear = rangeMatch[4] || null;
    const month = parseGreekMonth(monthStr) || '06';
    const year = resolveEventYear(month, explicitYear, contextYear);

    return {
      startDate: `${year}-${month}-${startDay}`,
      endDate: `${year}-${month}-${endDay}`,
      displayDate: `${parseInt(startDay)}-${parseInt(endDay)} ${monthStr.substring(0, 4)}`
    };
  }

  // Format: "14 Ιουνίου 2026" or "05 Ιουλ 2026" or "14 Ιουνίου"
  const singleMatch = cleanText.match(/^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i);
  if (singleMatch) {
    const day = singleMatch[1].padStart(2, '0');
    const monthStr = singleMatch[2];
    const explicitYear = singleMatch[3] || null;
    const month = parseGreekMonth(monthStr) || '06';
    const year = resolveEventYear(month, explicitYear, contextYear);

    return {
      startDate: `${year}-${month}-${day}`,
      endDate: `${year}-${month}-${day}`,
      displayDate: `${parseInt(day)} ${monthStr.substring(0, 4)}`
    };
  }

  // Fail-safe default
  const defaultYear = resolveEventYear('06', null, contextYear);
  return {
    startDate: `${defaultYear}-06-09`,
    endDate: `${defaultYear}-06-09`,
    displayDate: dateText
  };
}

// ----------------------------------------------------
// PARSER: EOS Acharnon (Next.js Hydration Cheerio)
// ----------------------------------------------------
function parseEosAcharnon() {
  const htmlPath = path.join(INPUT_DIR, 'eosacharnon_xmiddleware_com_el.html');
  if (!fs.existsSync(htmlPath)) return [];
  
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const events = [];

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
      
      const relativeHref = ev.id ? `/el/booking/${ev.id}` : '';
      const url = relativeHref 
        ? `https://eosacharnon.xmiddleware.com${relativeHref}` 
        : 'https://eosacharnon.xmiddleware.com/el/booking';
      
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
// PARSER: AOS (Multi-file & HTML URL Mapper)
// ----------------------------------------------------
function parseAos() {
  const urlMap = {};
  const aosHtmlFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('aos_gr_') && f.endsWith('.html'));

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

  const aosTxtFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('aos_gr_') && f.endsWith('.txt'));
  const events = [];

  for (const txtFile of aosTxtFiles) {
    const txtPath = path.join(INPUT_DIR, txtFile);
    if (!fs.existsSync(txtPath)) continue;

    const defaultUrl = 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/';
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');

    let currentSectionYear = null;
    let lastSeenMonth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check for section header like "Ιανουάριος 2026" or "Σεπτέμβριος 2026" or "Ιανουάριος 2027"
      const headerMatch = line.match(/^([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d{4})$/i);
      if (headerMatch && !line.includes('Δηλώσεις')) {
        const hMonth = parseGreekMonth(headerMatch[1]);
        if (hMonth) {
          currentSectionYear = headerMatch[2];
          lastSeenMonth = parseInt(hMonth, 10);
        }
        continue;
      }

      // Check for semester header like "Πρόγραμμα Σεπτέμβριος 2026 – Μάιος 2027"
      const semesterMatch = line.match(/(\d{4})\s*[-–—]\s*(\d{4})/);
      if (semesterMatch && line.length < 80) {
        currentSectionYear = semesterMatch[1];
      }

      // Numeric formats:
      // 1: 31/01 - 01/02/26 or 21/08/26 - 1/9/2026
      const numCrossMonth = /^(\d+)\/(\d+)(?:\/(\d+))?\s*[-–—]\s*(\d+)\/(\d+)(?:\/(\d+))?\s*[-–—]?\s*(.+)/.exec(line);
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

      if (pStartDay && pStartMonth) {
        const sMonthStr = String(pStartMonth).padStart(2, '0');
        const eMonthStr = String(pEndMonth || pStartMonth).padStart(2, '0');
        const sDayStr = String(pStartDay).padStart(2, '0');
        const eDayStr = String(pEndDay || pStartDay).padStart(2, '0');

        const sMonthNum = parseInt(sMonthStr, 10);
        
        // Month wrap detection: if sequence went from Dec (12) to Jan (1), increment section year
        if (lastSeenMonth === 12 && sMonthNum === 1 && currentSectionYear) {
          currentSectionYear = String(parseInt(currentSectionYear, 10) + 1);
        }
        lastSeenMonth = sMonthNum;

        const sYear = resolveEventYear(sMonthStr, pYear, currentSectionYear);
        let eYear = resolveEventYear(eMonthStr, pYear, currentSectionYear);
        if (parseInt(eMonthStr) < parseInt(sMonthStr)) {
          eYear = String(parseInt(sYear) + 1);
        }

        const sDate = `${sYear}-${sMonthStr}-${sDayStr}`;
        const eDate = `${eYear}-${eMonthStr}-${eDayStr}`;
        const dDate = sDayStr !== eDayStr ? `${parseInt(sDayStr)}/${parseInt(sMonthStr)} - ${parseInt(eDayStr)}/${parseInt(eMonthStr)}` : `${parseInt(sDayStr)}/${parseInt(sMonthStr)}`;

        let cleanTitle = (pTitle || '').split('Λεπτομέρειες')[0].trim();
        cleanTitle = cleanTitle.split('Αρχηγοί')[0].trim();
        cleanTitle = cleanTitle.replace(/^[–\-:\s]+|[–\-:\s]+$/g, '').trim();

        if (cleanTitle && cleanTitle.length >= 3) {
           events.push({
             startDate: sDate,
             endDate: eDate,
             displayDate: dDate,
             title: cleanTitle,
             club: 'ΑΟΣ',
             url: matchTitleToUrl(cleanTitle, urlMap, defaultUrl),
             difficulty: ''
           });
        }
        continue;
      }

      // Existing String formats (e.g. "12-14 Ιουνίου 2026")
      const isRange = /^(\d+)-(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i.test(line);
      const isSingle = /^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i.test(line);
      const isMultiMonth = /^(?:Παρασκευή|Σάββατο)?\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+έως\s+(?:Κυριακή|Δευτέρα|Τρίτη)?\s*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i.test(line);

      if (isRange || isSingle || isMultiMonth) {
        const dateStr = line;
        let title = '';
        if (lines[i+1]) title = lines[i+1].trim();
        
        let parsed = parseDateRange(dateStr, currentSectionYear);
        if (parsed && title.length >= 3) {
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
// PARSER: POA (Elementor Accordion Cheerio)
// ----------------------------------------------------
function parsePoa() {
  const htmlPath = path.join(INPUT_DIR, 'poa_gr_index_php-programma.html');
  if (!fs.existsSync(htmlPath)) return [];

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const events = [];

  let currentMonth = '';
  let currentYear = String(TODAY.getFullYear());

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
        }
      }
    } else {
      if (!currentMonth) return;

      const titleEl = $el.find('.elementor-toggle-title, .elementor-accordion-title');
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

      // Format 2: Single-month range or single date: "23 – 30/6 Title" or "10/1 Title"
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
// PARSER: EOS Athinon (Program + Climbs Abroad)
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
    const year = yearMatch ? yearMatch[1] : String(TODAY.getFullYear());

    let startDate = '';
    let endDate = '';
    let displayDate = '';

    for (let j = 0; j < Math.min(pTags.length, 5); j++) {
      const pText = $(pTags[j]).text().trim().replace(/\s+/g, ' ');
      
      let cleanText = stripGreekAccents(pText).toLowerCase()
        .replace(/(?:megalo sabbato|μεγαλο σαββατο|megali paraskeyi|μεγαλη παρασκευη)/g, '')
        .replace(/(?:δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/g, '')
        .replace(/(?:δευτ|τρι|τετ|πεμ|παρ|σαβ|κυρ)\.?/g, '')
        .replace(/\s+/g, ' ')
        .trim();

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
    }

    if (!startDate) return;

    let title = firstPText;
    const stripPattern = new RegExp(`\\s*[-–—]?\\s*(?:[A-Za-zΑ-Ωα-ωίϊΐόάέύώήώ]+)?\\s*${year}`, 'i');
    title = title.replace(stripPattern, '').trim();
    title = title.replace(/\s*[-–—]\s*$/, '').trim();

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
    let currentSectionYear = String(TODAY.getFullYear());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Heading detection: e.g. "ΣΕΠΤΕΜΒΡΙΟΣ 2026" or "ΙΑΝΟΥΑΡΙΟΣ 2027"
      const headerMatch = line.match(/^([Α-Ωα-ωίϊΐόάέύώήώ\s]+)\s+(\d{4})$/i);
      if (headerMatch && headerMatch[1].length < 30) {
        const monthParsed = parseGreekMonth(headerMatch[1]);
        if (monthParsed) {
          currentSectionYear = headerMatch[2];
        }
      }

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

        let titlePart = cleanLine.replace(datePart, '');
        titlePart = titlePart.replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '');
        titlePart = titlePart
          .replace(/^[–\-:\s]+|[–\-:\s]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        titlePart = titlePart.split(/\d+:/)[0].trim().replace(/[–\-:\s]+$/, '');
        titlePart = titlePart.replace(/\d+\/\d*\s*$/, '').trim();

        const parsed = parseDateRange(datePart, currentSectionYear);

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
// PARSER: EOS Ilioupolis (JSON API)
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
      if (trip.cancelled || trip.archived || trip.published === false) continue;
      const title = (trip.title_gr || trip.title || '').trim();
      if (!title) continue;

      let startDate = '';
      let endDate = '';
      let displayDate = '';

      if (trip.start_date && /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date)) {
        startDate = trip.start_date;
        if (trip.end_date && /^\d{4}-\d{2}-\d{2}$/.test(trip.end_date)) {
          endDate = trip.end_date;
        } else if (trip.duration_days && Number(trip.duration_days) > 1) {
          const [y, m, d] = startDate.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          dt.setDate(dt.getDate() + (Number(trip.duration_days) - 1));
          const ey = dt.getFullYear();
          const em = String(dt.getMonth() + 1).padStart(2, '0');
          const ed = String(dt.getDate()).padStart(2, '0');
          endDate = `${ey}-${em}-${ed}`;
        } else {
          endDate = startDate;
        }

        const [sy, sm, sd] = startDate.split('-');
        const [ey, em, ed] = endDate.split('-');
        if (startDate === endDate) {
          displayDate = `${parseInt(sd, 10)}/${parseInt(sm, 10)}`;
        } else if (sm === em) {
          displayDate = `${parseInt(sd, 10)}-${parseInt(ed, 10)}/${parseInt(sm, 10)}`;
        } else {
          displayDate = `${parseInt(sd, 10)}/${parseInt(sm, 10)} - ${parseInt(ed, 10)}/${parseInt(em, 10)}`;
        }

        events.push({
          startDate,
          endDate,
          displayDate,
          title,
          club: 'ΕΟΣ Ηλιούπολης',
          url: trip.slug ? `https://eosh.gr/expeditions/${trip.slug}` : defaultUrl,
          difficulty: trip.difficulty ? String(trip.difficulty).trim() : ''
        });
        continue;
      }
    }
  } catch (e) {
    console.error('Failed to parse EOS Hlioupolis API payload:', e.message);
  }

  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: FONI (Cheerio Article & Text)
// ----------------------------------------------------
function parseFoni() {
  const htmlPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.html');
  const txtPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.txt');
  const defaultUrl = 'https://www.foni.org.gr/category/ekdromes/';
  const urlMap = {};
  const events = [];

  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('article').each((i, el) => {
        const titleLink = $(el).find('.elementor-post__title a');
        const rawTitle = titleLink.text().trim();
        const href = titleLink.attr('href');
        if (rawTitle && href) {
          urlMap[rawTitle] = href;

          // Check if article title has dates: e.g. "12-13 Σεπτεμβρίου 2026 / Πεζοπορική – Εύβοια..."
          const match = rawTitle.match(/^([^/]+)\s*\/\s*(?:Πεζοπορική|Καλοκαιρινή|Περιηγητική|Εκδρομές)?\s*[:–-]?\s*(.+)$/i);
          if (match) {
            const dateText = match[1].trim();
            const eventTitle = match[2].trim();
            const parsed = parseDateRange(dateText);
            if (parsed && eventTitle.length >= 3) {
              events.push({
                startDate: parsed.startDate,
                endDate: parsed.endDate,
                displayDate: parsed.displayDate,
                title: eventTitle,
                club: 'ΦΟΝΙ',
                url: href,
                difficulty: ''
              });
            }
          }
        }
      });
    } catch (e) {
      console.error('Failed to parse FONI article list:', e.message);
    }
  }

  // Fallback text parser
  if (events.length === 0 && fs.existsSync(txtPath)) {
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

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
  }

  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: EPOS Filis (Tribe Events Cheerio DOM)
// ----------------------------------------------------
function parseEposFilis() {
  const htmlPath = path.join(INPUT_DIR, 'eposfilis_gr_events-category-_ce_b7_ce_bc_ce_b5_cf_81_ce_bf_ce_bb_cf_8c_ce_b3_ce_b9_ce_bf.html');
  const txtPath = path.join(INPUT_DIR, 'eposfilis_gr_events-category-_ce_b7_ce_bc_ce_b5_cf_81_ce_bf_ce_bb_cf_8c_ce_b3_ce_b9_ce_bf.txt');
  const defaultUrl = 'https://eposfilis.gr/events/category/%ce%b7%ce%bc%ce%b5%cf%81%ce%bf%ce%bb%cf%8c%ce%b3%ce%b9%ce%bf/';
  const events = [];

  const parseMonthName = (mStr) => {
    const clean = (mStr || '').toLowerCase().trim();
    const map = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12',
      'ιανουαριος': '01', 'φεβρουαριος': '02', 'μαρτιος': '03', 'απριλιος': '04',
      'μαιος': '05', 'ιουνιος': '06', 'ιουλιος': '07', 'αυγουστος': '08',
      'σεπτεμβριος': '09', 'οκτωβριος': '10', 'νοεμβριος': '11', 'δεκεμβριος': '12'
    };
    return map[clean] || null;
  };

  // Strategy 1: Cheerio HTML DOM parsing on Tribe Events markup (Primary)
  if (fs.existsSync(htmlPath)) {
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);

      $('.tribe-events-calendar-list__event-row').each((i, el) => {
        const $row = $(el);
        const titleLink = $row.find('.tribe-events-calendar-list__event-title-link');
        let rawTitle = titleLink.text().trim();
        const href = titleLink.attr('href') || defaultUrl;

        // Datetime tag
        const timeEl = $row.find('time.tribe-events-calendar-list__event-datetime');
        const dtAttr = timeEl.attr('datetime'); // e.g. "2027-01-17" or "2026-08-28"
        const dateText = timeEl.text().trim(); // e.g. "January 17, 2027 @ 7:00 am - 5:00 pm" or "August 28 @ 2:00 pm - September 1 @ 5:00 pm"

        if (!dtAttr && !dateText) return;

        let startDate = dtAttr || '';
        let endDate = startDate;
        let displayDate = '';

        const multiMonthMatch = dateText.match(/([a-zA-Z]+)\s+(\d+)(?:,\s*(\d{4}))?\s*@.+?-\s*([a-zA-Z]+)\s+(\d+)(?:,\s*(\d{4}))?/i);
        const sameMonthMultiDayMatch = dateText.match(/([a-zA-Z]+)\s+(\d+)(?:,\s*(\d{4}))?\s*@.+?-\s*(?:[a-zA-Z]+\s+)?(\d+)(?:,\s*(\d{4}))?\s*@/i);
        
        if (multiMonthMatch) {
          const sMonth = parseMonthName(multiMonthMatch[1]);
          const sDay = multiMonthMatch[2].padStart(2, '0');
          const sYear = multiMonthMatch[3] || (startDate ? startDate.split('-')[0] : resolveEventYear(sMonth));
          const eMonth = parseMonthName(multiMonthMatch[4]);
          const eDay = multiMonthMatch[5].padStart(2, '0');
          const eYear = multiMonthMatch[6] || (parseInt(eMonth) < parseInt(sMonth) ? String(parseInt(sYear) + 1) : sYear);

          startDate = `${sYear}-${sMonth}-${sDay}`;
          endDate = `${eYear}-${eMonth}-${eDay}`;
          displayDate = `${parseInt(sDay)}/${parseInt(sMonth)} - ${parseInt(eDay)}/${parseInt(eMonth)}`;
        } else if (sameMonthMultiDayMatch) {
          const sMonth = parseMonthName(sameMonthMultiDayMatch[1]);
          const sDay = sameMonthMultiDayMatch[2].padStart(2, '0');
          const sYear = sameMonthMultiDayMatch[3] || (startDate ? startDate.split('-')[0] : resolveEventYear(sMonth));
          const eDay = sameMonthMultiDayMatch[4].padStart(2, '0');
          const eYear = sameMonthMultiDayMatch[5] || sYear;

          startDate = `${sYear}-${sMonth}-${sDay}`;
          endDate = `${eYear}-${sMonth}-${eDay}`;
          displayDate = `${parseInt(sDay)}-${parseInt(eDay)}/${parseInt(sMonth)}`;
        } else if (startDate) {
          const [y, m, d] = startDate.split('-');
          displayDate = `${parseInt(d)}/${parseInt(m)}`;
        }

        // Clean title: remove leading date fragments if they exist in title
        let cleanTitle = rawTitle
          .replace(/^\d+(?:\s*[-–—]\s*\d+)?\s*\/\s*\d+(?:\/\d{2,4})?\s*(?:[-–—]\s*\d+(?:\s*[-–—]\s*\d+)?\s*\/\s*\d+(?:\/\d{2,4})?)?\s*/, '')
          .replace(/^(?:Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή)\s*/i, '')
          .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (!cleanTitle) cleanTitle = rawTitle;

        if (startDate && cleanTitle.length >= 3) {
          events.push({
            startDate,
            endDate,
            displayDate,
            title: cleanTitle,
            club: 'ΕΠΟΣ Φυλής',
            url: href,
            difficulty: ''
          });
        }
      });
    } catch (e) {
      console.error('Failed to parse EPOS Filis HTML DOM:', e.message);
    }
  }

  // Strategy 2: Text regex parsing fallback if Strategy 1 yields 0 events
  if (events.length === 0 && fs.existsSync(txtPath)) {
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');
    let currentSectionYear = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const headerMatch = line.match(/^([a-zA-ZΑ-Ωα-ω]+)\s+(\d{4})$/i);
      if (headerMatch) {
        currentSectionYear = headerMatch[2];
        continue;
      }

      // Pattern 1: Starts with date e.g. "13-14/6" or "17 /1"
      const pattern1 = line.match(/^(\d+(?:\s*[-–—]\s*\d+)?)\s*\/\s*(\d+)(?:\/(\d{2,4}))?\s+(.+)$/);
      if (pattern1) {
        const dateStr = pattern1[1].replace(/\s+/g, '');
        const monthNum = pattern1[2].padStart(2, '0');
        const explicitYear = pattern1[3] || null;
        const rest = pattern1[4];
        
        let title = rest.split(/Πεζοπορίες|Αναχώρηση|Ενεργοποίηση/i)[0].trim();
        title = title.replace(/[:–-]$/, '').trim();

        const year = resolveEventYear(monthNum, explicitYear, currentSectionYear);
        let startDate = '';
        let endDate = '';
        let displayDate = '';

        if (dateStr.includes('-')) {
          const [sDay, eDay] = dateStr.split('-');
          startDate = `${year}-${monthNum}-${sDay.padStart(2, '0')}`;
          endDate = `${year}-${monthNum}-${eDay.padStart(2, '0')}`;
          displayDate = `${parseInt(sDay)}-${parseInt(eDay)}/${parseInt(monthNum)}`;
        } else {
          startDate = `${year}-${monthNum}-${dateStr.padStart(2, '0')}`;
          endDate = `${year}-${monthNum}-${dateStr.padStart(2, '0')}`;
          displayDate = `${parseInt(dateStr)}/${parseInt(monthNum)}`;
        }

        if (title.length >= 3) {
          events.push({
            startDate,
            endDate,
            displayDate,
            title,
            club: 'ΕΠΟΣ Φυλής',
            url: defaultUrl,
            difficulty: ''
          });
        }
      }
    }
  }

  const seen = new Set();
  return events.filter(e => {
    const key = `${e.startDate}_${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------
// PARSER: ΦΟΠ (Cheerio Accordion & Text)
// ----------------------------------------------------
function parseFop() {
  const htmlPath = path.join(INPUT_DIR, 'fop_gr.html');
  const txtPath = path.join(INPUT_DIR, 'fop_gr.txt');
  const events = [];

  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const $ = cheerio.load(html);

    $('.gdlr-core-accordion-item-tab').each((i, el) => {
      const dateHead = $(el).find('.gdlr-core-head').text().trim();
      
      const titleEl = $(el).find('.gdlr-core-accordion-item-title').clone();
      titleEl.find('.gdlr-core-head').remove();
      const rawTitle = titleEl.text().trim();

      const contentText = $(el).find('.gdlr-core-accordion-item-content').text().trim();

      if (!dateHead && !rawTitle) return;

      const fullDateStr = dateHead || rawTitle;
      const parsedDate = parseDateRange(fullDateStr);

      let difficulty = '';
      const bdMatch = contentText.match(/ΒΔ:\s*([\d\w+]+)/i);
      if (bdMatch) {
        difficulty = 'ΒΔ ' + bdMatch[1].trim();
      }

      let cleanTitle = rawTitle.replace(/\s+/g, ' ').trim();
      if (!cleanTitle && dateHead) {
        cleanTitle = fullDateStr.replace(dateHead, '').trim();
      }

      // Clean day names and leading punctuation from title
      cleanTitle = cleanTitle
        .replace(/^(?:Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή)\s*/i, '')
        .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
        .trim();

      if (parsedDate && parsedDate.startDate && cleanTitle.length >= 3) {
        events.push({
          startDate: parsedDate.startDate,
          endDate: parsedDate.endDate,
          displayDate: parsedDate.displayDate,
          title: cleanTitle,
          club: 'ΦΟΠ',
          url: 'https://fop.gr/#:~:text=' + encodeURIComponent(cleanTitle),
          difficulty
        });
      }
    });
  }

  // Fallback text parser
  if (events.length === 0 && fs.existsSync(txtPath)) {
    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(/(?:[Α-Ωα-ω\s]+)?(\d{1,2}(?:[\.\/]\d{1,2})?(?:\s*[-–—]\s*\d{1,2}[\.\/]\d{1,2})?[\.\/]\d{2,4})\s*(.*)/i);
      if (match) {
        const dateStr = match[1];
        const restTitle = match[2];
        const parsedDate = parseDateRange(dateStr);

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

        if (parsedDate && parsedDate.startDate && restTitle.trim().length >= 3) {
          events.push({
            startDate: parsedDate.startDate,
            endDate: parsedDate.endDate,
            displayDate: parsedDate.displayDate,
            title: restTitle.replace(/\s+/g, ' ').trim(),
            club: 'ΦΟΠ',
            url: 'https://fop.gr/#:~:text=' + encodeURIComponent(restTitle.replace(/\s+/g, ' ').trim()),
            difficulty
          });
        }
      }
    }
  }

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

  // Filter out invalid dates, and keep only upcoming / current events (endDate >= TODAY or startDate >= TODAY)
  allEvents = allEvents.filter(e => {
    if (!e.startDate || e.startDate === 'NaN-NaN-NaN' || !/^\d{4}-\d{2}-\d{2}$/.test(e.startDate)) return false;
    const evEndDate = new Date(e.endDate || e.startDate);
    const evStartDate = new Date(e.startDate);
    return evEndDate >= TODAY || evStartDate >= TODAY;
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
      
      const isSubset = t1.includes(t2) || t2.includes(t1);
      const isWordMatch = overlap >= 1 && (overlap / Math.min(words1.length, words2.length)) >= 0.4;

      if (isSubset || isWordMatch) {
        if (isSubset) {
          if (ev.title.length < duplicate.title.length) duplicate.title = ev.title;
        } else {
          if (ev.title.length > duplicate.title.length) duplicate.title = ev.title;
        }
        const evHasFrag = ev.url.includes('#:~:text=');
        const dupHasFrag = duplicate.url.includes('#:~:text=');
        if (!evHasFrag && dupHasFrag) {
          duplicate.url = ev.url;
        } else if (evHasFrag && dupHasFrag && ev.url.length > duplicate.url.length) {
          duplicate.url = ev.url;
        }
        continue;
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
