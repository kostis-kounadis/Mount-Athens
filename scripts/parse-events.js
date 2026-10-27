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

function isSchoolTitle(title) {
  if (!title) return false;
  const clean = stripGreekAccents(title).toLowerCase();
  if (clean.includes('αποφοιτ')) return false;
  return /(?:^|[^a-zα-ω0-9])σχολ(?:η|ες|ης|ων)(?:$|[^a-zα-ω0-9])/i.test(clean);
}

function normalizeDifficulty(raw) {
  if (!raw) return '';
  let clean = String(raw)
    .replace(/^(?:Β\.?\s*Δ\.?|Βαθμ[οό]ς\s+Δυσκολ[ιί]ας)\s*[:=]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || /^beginners$/i.test(clean)) return '';
  clean = clean
    .replace(/^X(\d)/i, 'Χ$1')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/[.,;:]+$/, '')
    .trim();
  return clean;
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

  // Format: "18.09.- 20.09.2026" or "18.09 - 20.09.2026" or "31.10.- 01.11.2026" or "30-31/10 & 1/11/26"
  const dotCrossMonthMatch = cleanText.match(/(\d{1,2})(?:\s*[-–—]\s*\d{1,2})*\s*[\.\/]\s*(\d{1,2})\.?\s*(?:[-–—&]|και)\s*(?:\d{1,2}\s*[-–—]\s*)*(\d{1,2})\s*[\.\/]\s*(\d{1,2})(?:\s*[\.\/]\s*(\d{2,4}))?/i);
  if (dotCrossMonthMatch) {
    const startDay = dotCrossMonthMatch[1].padStart(2, '0');
    const startMonth = dotCrossMonthMatch[2].padStart(2, '0');
    const endDay = dotCrossMonthMatch[3].padStart(2, '0');
    const endMonth = dotCrossMonthMatch[4].padStart(2, '0');
    const explicitYear = dotCrossMonthMatch[5] || null;

    const sMonthNum = parseInt(startMonth, 10);
    const eMonthNum = parseInt(endMonth, 10);
    const currentAthensMonth = TODAY.getMonth() + 1;

    let startYear = resolveEventYear(startMonth, explicitYear, contextYear);
    if (!explicitYear && !contextYear && sMonthNum < currentAthensMonth && eMonthNum >= currentAthensMonth && eMonthNum > sMonthNum) {
      startYear = String(TODAY.getFullYear());
    }
    let endYear = startYear;
    if (eMonthNum < sMonthNum) {
      endYear = String(parseInt(startYear, 10) + 1);
    }

    return {
      startDate: `${startYear}-${startMonth}-${startDay}`,
      endDate: `${endYear}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "27-28.09.2026" or "27-28.9.2026" or "7 – 8 /11" or "21-22-23/02"
  const dotSameMonthMatch = cleanText.match(/(\d{1,2})(?:\s*[-–—]\s*\d{1,2})*\s*[-–—]\s*(\d{1,2})\s*[\.\/]\s*(\d{1,2})(?:\s*[\.\/]\s*(\d{2,4}))?/);
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

  // Format: "27/09/2026" or "27.09.2026" or "27/09" or "6 /12"
  const dotSingleMatch = cleanText.match(/(\d{1,2})\s*[\.\/]\s*(\d{1,2})(?:\s*[\.\/]\s*(\d{2,4}))?/);
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

  // Format: "29 Μαΐου – 01 Ιουνίου 2026" or "21 Αυγούστου έως 30 Αυγούστου 2026" or "30-31 Αυγούστου & 01 Σεπτεμβρίου 2025"
  const rangeTwoMonthsMatch = cleanText.match(/^(\d+)(?:\s*[-–—]\s*\d+)*\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s*(?:[-–—&]|έως|εως|και)\s*(?:\d+\s*[-–—]\s*)*(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i);
  if (rangeTwoMonthsMatch) {
    const startDay = rangeTwoMonthsMatch[1].padStart(2, '0');
    const startMonthStr = rangeTwoMonthsMatch[2];
    const endDay = rangeTwoMonthsMatch[3].padStart(2, '0');
    const endMonthStr = rangeTwoMonthsMatch[4];
    const explicitYear = rangeTwoMonthsMatch[5] || null;

    const startMonth = parseGreekMonth(startMonthStr) || '06';
    const endMonth = parseGreekMonth(endMonthStr) || '06';
    const sMonthNum = parseInt(startMonth, 10);
    const eMonthNum = parseInt(endMonth, 10);
    const currentAthensMonth = TODAY.getMonth() + 1;

    let startYear = resolveEventYear(startMonth, explicitYear, contextYear);
    if (!explicitYear && !contextYear && sMonthNum < currentAthensMonth && eMonthNum >= currentAthensMonth && eMonthNum > sMonthNum) {
      startYear = String(TODAY.getFullYear());
    }
    let endYear = startYear;
    if (eMonthNum < sMonthNum) {
      endYear = String(parseInt(startYear, 10) + 1);
    }

    return {
      startDate: `${startYear}-${startMonth}-${startDay}`,
      endDate: `${endYear}-${endMonth}-${endDay}`,
      displayDate: `${parseInt(startDay)}/${parseInt(startMonth)} - ${parseInt(endDay)}/${parseInt(endMonth)}`
    };
  }

  // Format: "12-14 Ιουνίου 2026" or "27-28 Ιουν" or "Σάββατο 14 Κυριακή 15 Νοεμβρίου 2026" (cleaned to "14 15 Νοεμβρίου 2026")
  const rangeMatch = cleanText.match(/^(\d+)(?:\s*[-–—]\s*\d+)*(?:\s*[-–—&,]\s*|\s+)(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?/i);
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

  return null;
}

// ----------------------------------------------------
// PARSER: EOS Acharnon (JSON API + Next.js Hydration Fallback)
// ----------------------------------------------------
function parseEosAcharnon() {
  const events = [];
  const DIFFICULTY_MAP = {
    'A': 'Α',
    'A_PLUS': 'Α+',
    'B': 'Β',
    'B_PLUS': 'Β+',
    'C': 'Γ',
    'C_PLUS': 'Γ+',
    'D': 'Δ',
    'D_PLUS': 'Δ+'
  };

  const processRawEvents = (rawEvents) => {
    if (!Array.isArray(rawEvents)) return;
    rawEvents.forEach(ev => {
      if (ev.isActive === false) return;

      const adjustDate = (dateStr) => {
        if (!dateStr) return '';
        const utcDate = new Date(dateStr);
        if (isNaN(utcDate.getTime())) return '';
        return athensFormatter.format(utcDate);
      };

      const startDate = adjustDate(ev.startDate);
      const endDate = adjustDate(ev.endDate) || startDate;
      if (!startDate) return;

      let displayDate = '';
      if (startDate && endDate) {
        const startParts = startDate.split('-');
        const endParts = endDate.split('-');
        const startDay = parseInt(startParts[2], 10);
        const startMonth = parseInt(startParts[1], 10);
        const endDay = parseInt(endParts[2], 10);
        const endMonth = parseInt(endParts[1], 10);

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

      const GRADE_ORDER = ['Α', 'Α+', 'Β', 'Β+', 'Γ', 'Γ+', 'Δ', 'Δ+'];
      const mappedDiffs = ev.difficulties && ev.difficulties.length > 0
        ? [...new Set(ev.difficulties.map(d => DIFFICULTY_MAP[d] || d))]
            .sort((a, b) => {
              const ia = GRADE_ORDER.indexOf(a);
              const ib = GRADE_ORDER.indexOf(b);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            })
        : [];
      const difficulty = mappedDiffs.join(', ');

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
  };

  // Strategy 1: Direct unpaginated JSON API
  const apiPath = path.join(INPUT_DIR, 'eosacharnon_xmiddleware_com_api-events.html');
  if (fs.existsSync(apiPath)) {
    try {
      const rawJson = fs.readFileSync(apiPath, 'utf-8').trim();
      if (rawJson.startsWith('[')) {
        const parsed = JSON.parse(rawJson);
        processRawEvents(parsed);
      }
    } catch (err) {
      console.error('Failed to parse Acharnon JSON API payload:', err.message);
    }
  }

  // Strategy 2: Next.js HTML Hydration fallback across any fetched /el pages
  if (events.length === 0) {
    const htmlFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('eosacharnon_xmiddleware_com_el') && f.endsWith('.html'));
    for (const file of htmlFiles) {
      const htmlPath = path.join(INPUT_DIR, file);
      const html = fs.readFileSync(htmlPath, 'utf-8');
      const $ = cheerio.load(html);

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
      if (eventsIndex === -1) continue;

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
        processRawEvents(rawEvents);
      } catch (err) {
        console.error(`Failed to parse Acharnon Next.js hydration payload in ${file}:`, err.message);
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
// PARSER: AOS (Multi-file & HTML URL Mapper)
// ----------------------------------------------------
function parseAos() {
  const urlMap = {};
  const dateUrlMap = {};
  const events = [];
  const defaultUrl = 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/';
  const aosHtmlFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('aos_gr_') && f.endsWith('.html'));

  const isPlaceholderTitle = (t) => /^αναμ[εέ]ν(εται|ονται)/i.test(stripGreekAccents(t).trim());
  const isMetadataLine = (t) => /^(αρχηγοι|ομαδα|ω\.?π|ωρα|διαθεσιμοτητα|συμμετοχες|κοστος|αναχωρηση|σημειωση|λεπτομερειες|για λεπτομερειες|ετικετες|τρεχουσες και επερχομενες)/i.test(stripGreekAccents(t).trim());

  for (const file of aosHtmlFiles) {
    const filePath = path.join(INPUT_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const html = fs.readFileSync(filePath, 'utf-8');
    const $ = cheerio.load(html);

    // 1. Parse structured .hgrid.entry-content event cards (used on trechouses page)
    $('div.hgrid.entry-content').each((i, el) => {
      const $card = $(el);
      const dateText = $card.find('.hgrid-span-3 h4, h4').first().text().replace(/\s+/g, ' ').trim();
      const h2Text = $card.find('.hgrid-span-3 h2, h2').first().text().replace(/\s+/g, ' ').trim();
      const pRaw = $card.find('.hgrid-span-5 p, p').first().html() || '';
      const pFirstLine = cheerio.load(pRaw.split(/<br\s*\/?>/i)[0] || '').text().replace(/\s+/g, ' ').trim();
      const pClean = pFirstLine.replace(/Αναμένονται\s+λεπτομέρειες\.?/gi, '').trim();

      let href = '';
      $card.find('a').each((j, aEl) => {
        const h = $(aEl).attr('href') || '';
        if (h.startsWith('https://aos.gr/') && !h.includes('/category/') && !h.includes('/tag/') && !h.includes('/wp-content/') && !h.includes('trechouses') && !h.includes('programma-') && h.length > 25) {
          href = h;
        }
      });

      const parsedDate = parseDateRange(dateText);
      if (!parsedDate) return;

      let title = h2Text;
      if (!title && pClean) {
        title = pClean.replace(/\.$/, '').trim();
      } else if (title && !title.includes(' ') && pClean && /^επετειακ/i.test(stripGreekAccents(pClean))) {
        title = `${title}: ${pClean.replace(/\.$/, '').trim()}`;
      }

      if (!title || title.length < 3 || isPlaceholderTitle(title)) return;

      if (href) {
        urlMap[title] = href;
        if (h2Text) urlMap[h2Text] = href;
        dateUrlMap[parsedDate.startDate] = dateUrlMap[parsedDate.startDate] || href;
      }

      events.push({
        startDate: parsedDate.startDate,
        endDate: parsedDate.endDate,
        displayDate: parsedDate.displayDate,
        title,
        club: 'ΑΟΣ',
        url: href || matchTitleToUrl(title, urlMap, defaultUrl),
        difficulty: ''
      });
    });

    // 2. Build urlMap across headings/strong paragraphs for annual program tables
    let lastSeenTitle = '';
    $('*').each((i, el) => {
      const tagName = el.tagName.toLowerCase();
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      if (tagName === 'h2' || tagName === 'h3' || (tagName === 'p' && $(el).find('strong').length > 0)) {
        if (text.length > 4 && text.length < 150 && !isMetadataLine(text)) {
          lastSeenTitle = text;
        }
      }

      if (tagName === 'a') {
        const href = $(el).attr('href');
        if (href && href.startsWith('https://aos.gr/') && !href.includes('/category/') && !href.includes('/tag/') && !href.includes('/feed/') && !href.includes('/wp-content/') && !href.includes('trechouses') && !href.includes('programma-') && href.length > 25) {
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

  const aosTxtFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('aos_gr_') && f.endsWith('.txt'));

  for (const txtFile of aosTxtFiles) {
    const txtPath = path.join(INPUT_DIR, txtFile);
    if (!fs.existsSync(txtPath)) continue;

    const content = fs.readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');

    // Seed section year from filename if available (e.g. "...2026...2026.txt" or "...2026...2027.txt")
    const fileYears = [...txtFile.matchAll(/(20\d{2})/g)].map(m => m[1]);
    const programStartYear = fileYears[0] || null;
    const programEndYear = fileYears[fileYears.length - 1] || programStartYear;

    let currentSectionYear = programStartYear;
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

      // Check for semester/annual header like "Πρόγραμμα εξορμήσεων Ιανουάριος 2026 – Δεκέμβριος 2026"
      const semesterMatch = line.match(/(\d{4})\s*[-–—]\s*(?:[Α-Ωα-ωίϊΐόάέύώήώ]+\s+)?(\d{4})/i);
      if (semesterMatch && line.length < 100) {
        currentSectionYear = semesterMatch[1];
      }

      // Standalone Greek month header like "Ιανουάριος" or "Φεβρουάριος"
      const standaloneMonth = parseGreekMonth(line);
      if (standaloneMonth && line.split(/\s+/).length === 1) {
        const mNum = parseInt(standaloneMonth, 10);
        if (lastSeenMonth === 12 && mNum === 1 && programStartYear) {
          currentSectionYear = programStartYear;
        }
        lastSeenMonth = mNum;
        continue;
      }

      // Numeric formats:
      // 1: 31/01 - 01/02/26 or 21/08/26 - 1/9/2026 or 30-31/05-01/06 or 30-31/10 & 1/11/26
      const numCrossMonth = /^(\d+)(?:-\d+)*\/(\d+)(?:\/(\d{2,4}))?\s*(?:[-–—&]|και)\s*(?:\d+-)*(\d+)\/(\d+)(?:\/(\d{2,4}))?\s*[-–—:]?\s*(.+)/i.exec(line);
      // 2: 03-05/01/26 or 14-15/02 or 21-22-23/02
      const numRangeMonth = /^(\d+)(?:-\d+)*-(\d+)\/(\d+)(?:\/(\d{2,4}))?\s*[-–—:]?\s*(.+)/.exec(line);
      // 3: 11/01/26 or 19/4
      const numSingleMonth = /^(\d+)\/(\d+)(?:\/(\d{2,4}))?\s*[-–—:]?\s*(.+)/.exec(line);

      let pStartDay, pEndDay, pStartMonth, pEndMonth, pYear, pTitle;

      if (numCrossMonth) {
        pStartDay = numCrossMonth[1];
        pStartMonth = numCrossMonth[2];
        const pStartYear = numCrossMonth[3];
        pEndDay = numCrossMonth[4];
        pEndMonth = numCrossMonth[5];
        const pEndYear = numCrossMonth[6];
        pYear = pStartYear || pEndYear;
        pTitle = numCrossMonth[7];
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
        if (sMonthNum < 1 || sMonthNum > 12 || parseInt(sDayStr, 10) > 31) continue;

        if (!pYear && lastSeenMonth === 12 && sMonthNum === 1 && currentSectionYear) {
          const nextY = String(parseInt(currentSectionYear, 10) + 1);
          currentSectionYear = (programEndYear && parseInt(nextY, 10) > parseInt(programEndYear, 10))
            ? programStartYear
            : nextY;
        }
        lastSeenMonth = sMonthNum;

        const sYear = resolveEventYear(sMonthStr, pYear, currentSectionYear);
        if (pYear) {
          currentSectionYear = sYear;
        }

        let eYear = sYear;
        if (parseInt(eMonthStr, 10) < parseInt(sMonthStr, 10)) {
          eYear = String(parseInt(sYear, 10) + 1);
        }

        const sDate = `${sYear}-${sMonthStr}-${sDayStr}`;
        const eDate = `${eYear}-${eMonthStr}-${eDayStr}`;
        let dDate = `${parseInt(sDayStr, 10)}/${parseInt(sMonthStr, 10)}`;
        if (sDate !== eDate) {
          dDate = sMonthStr === eMonthStr
            ? `${parseInt(sDayStr, 10)}-${parseInt(eDayStr, 10)}/${parseInt(sMonthStr, 10)}`
            : `${parseInt(sDayStr, 10)}/${parseInt(sMonthStr, 10)} - ${parseInt(eDayStr, 10)}/${parseInt(eMonthStr, 10)}`;
        }

        let cleanTitle = (pTitle || '').split('Λεπτομέρειες')[0].trim();
        cleanTitle = cleanTitle.split('Αρχηγοί')[0].trim();
        cleanTitle = cleanTitle.replace(/^[–\-:\s]+|[–\-:\s]+$/g, '').trim();

        let difficulty = '';
        for (let k = i; k <= Math.min(i + 12, lines.length - 1); k++) {
          if (k > i) {
            const nextL = lines[k].trim();
            if (/^\d+[\/\-]/.test(nextL) || parseGreekMonth(nextL)) break;
          }
          const bdMatch = lines[k].match(/(?:Β\.?\s*Δ\.?|Βαθμ[οό]ς\s+Δυσκολ[ιί]ας)\s*[:=]?\s*([0-9]+(?:\s*[+–\-]\s*[0-9+]*)?)/i);
          if (bdMatch) {
            difficulty = normalizeDifficulty(bdMatch[1]);
            break;
          }
        }

        if (cleanTitle && cleanTitle.length >= 3 && !isPlaceholderTitle(cleanTitle) && !/^\d+η\s+ημ[εέ]ρα/i.test(cleanTitle)) {
          const matchedUrl = matchTitleToUrl(cleanTitle, urlMap, defaultUrl);
          events.push({
            startDate: sDate,
            endDate: eDate,
            displayDate: dDate,
            title: cleanTitle,
            club: 'ΑΟΣ',
            url: matchedUrl,
            difficulty
          });
        }
        continue;
      }

      // Word-month date lines (e.g. "12-14 Ιουνίου 2026", "Κυριακή 22 Νοεμβρίου 2026", "Σάββατο 14 Κυριακή 15 Νοεμβρίου 2026")
      const lineNoDays = line
        .replace(/(Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή|δευτερα|τριτη|τεταρτη|πεμπτη|παρασκευη|σαββατο|κυριακη)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      const isRange = /^(\d+)(?:\s*[-–—]\s*\d+)*(?:\s*[-–—&,]\s*|\s+)(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?$/i.test(lineNoDays);
      const isSingle = /^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?$/i.test(lineNoDays);
      const isMultiMonth = /^(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)\s+(?:έως|εως|[-–—&]|και)\s+(\d+)\s+([Α-Ωα-ωίϊΐόάέύώήώ]+)(?:\s+(\d{4}))?$/i.test(lineNoDays);

      if (isRange || isSingle || isMultiMonth) {
        const dateStr = line;
        let title = '';
        for (let k = i + 1; k <= Math.min(i + 4, lines.length - 1); k++) {
          const candidate = lines[k].trim();
          if (candidate) {
            title = candidate.replace(/\.$/, '').trim();
            break;
          }
        }

        const parsed = parseDateRange(dateStr, currentSectionYear);
        if (parsed && title.length >= 3 && !isPlaceholderTitle(title) && !isMetadataLine(title)) {
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

  // Deduplicate events by title & startDate while preserving difficulty and dedicated URLs
  const seenMap = new Map();
  for (const e of events) {
    const key = `${e.startDate}_${e.title}`;
    if (!seenMap.has(key)) {
      seenMap.set(key, e);
    } else {
      const existing = seenMap.get(key);
      if (!existing.difficulty && e.difficulty) existing.difficulty = e.difficulty;
      if (existing.url.includes('#:~:text=') && !e.url.includes('#:~:text=')) existing.url = e.url;
    }
  }
  return Array.from(seenMap.values());
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

  $('h2.elementor-heading-title, h3.elementor-heading-title, h4.elementor-heading-title, .elementor-toggle-item, .elementor-accordion-item').each((i, el) => {
    const $el = $(el);
    const tagName = el.tagName.toLowerCase();

    if (tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
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
      const bodyText = $el.find('.elementor-tab-content').text().replace(/\s+/g, ' ').trim();
      const extractPoaBodyBd = () => {
        const m = bodyText.match(/Β\.?\s*Δ\.?\s*[:=]?\s*([ΧX]?\d+\+?(?:\s*(?:[-–—&]|ή)\s*[ΧX]?\d+\+?)*)/i);
        return m ? normalizeDifficulty(m[1]) : '';
      };
      const poaTitleBdRegex = /^(.+?)\s+(Β\.?Δ\.?\s*(?:[ΧX]?\d+\+?(?:\s*(?:[-–—&]|ή)\s*[ΧX]?\d+\+?)*))$/i;

      // Format 1: Cross-month range "30-31/12 – 1/1 Title"
      const crossMonthMatch = fullTitleText.match(/^(\d+(?:-\d+)*)\s*\/\s*(\d+)\s*[-–—]\s*(\d+(?:-\d+)*)\s*\/\s*(\d+)\s*(.+)$/);
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
        const bdMatch = rest.match(poaTitleBdRegex);
        if (bdMatch) {
          title = bdMatch[1].trim();
          difficulty = normalizeDifficulty(bdMatch[2]);
        } else {
          difficulty = extractPoaBodyBd();
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

      // Format 2: Single-month range or single date: "23 – 30/6 Title" or "12-13-14/6 Title" or "10/1 Title"
      const singleMonthMatch = fullTitleText.match(/^(\d+(?:\s*[-–—]\s*\d+)*)\s*\/\s*(\d+)\s+(.+)$/);
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
        const bdMatch = rest.match(poaTitleBdRegex);
        if (bdMatch) {
          title = bdMatch[1].trim();
          difficulty = normalizeDifficulty(bdMatch[2]);
        } else {
          difficulty = extractPoaBodyBd();
        }

        const dayPartClean = dayPart.replace(/\s*[-–—]\s*/g, '-').trim();
        let startDate = '';
        let endDate = '';
        let displayDate = '';

        if (dayPartClean.includes('-')) {
          const dayParts = dayPartClean.split('-');
          const startDay = dayParts[0];
          const endDay = dayParts[dayParts.length - 1];
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
    const yearMatch = fullText.match(/(20\d{2})/);
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
        const rangeTwoMonths = cleanLine.match(/(\d+(?:\s*[-–—]\s*\d+)*\s*\/\s*\d+\s*[-–—]\s*\d+(?:\s*[-–—]\s*\d+)*\s*\/\s*\d+(?:\s*\/\s*\d{2,4})?)/);
        const rangeOneMonth = cleanLine.match(/(\d+(?:\s*[-–—]\s*\d+)*\s*\/\s*\d+(?:\s*\/\s*\d{2,4})?)/);
        const singleDate = cleanLine.match(/(\d+\s*\/\s*\d+(?:\s*\/\s*\d{2,4})?)/);

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

          let difficulty = '';
          for (let k = i; k <= Math.min(i + 12, lines.length - 1); k++) {
            if (k > i && lines[k].trim().startsWith('📅')) break;
            const bdMatch = lines[k].match(/Β\.?\s*Δ\.?\s*[:=]\s*([0-9]+(?:\s*[+–\-]\s*[0-9+]*)?)/i);
            if (bdMatch) {
              difficulty = normalizeDifficulty(bdMatch[1]);
              break;
            }
          }
          
          events.push({
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            displayDate: parsed.displayDate,
            title: titlePart,
            club: 'ΕΟΣ Αθηνών',
            url: titlePart ? `https://www.eosathinon.gr/anavaseis/programma/#${accId}:~:text=${encodeURIComponent(titlePart)}` : 'https://www.eosathinon.gr/anavaseis/programma/',
            difficulty
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
      if (!title || isSchoolTitle(title)) continue;
      if (trip.slug && trip.slug.includes('-course-')) continue;

      let startDate = '';
      let endDate = '';
      let displayDate = '';

      if (trip.start_date && /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date)) {
        startDate = trip.start_date;
        if (trip.end_date && /^\d{4}-\d{2}-\d{2}$/.test(trip.end_date) && trip.end_date > startDate) {
          endDate = trip.end_date;
        } else if (trip.duration_days && Number(trip.duration_days) > 1) {
          const [y, m, d] = startDate.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          dt.setDate(dt.getDate() + (Number(trip.duration_days) - 1));
          const ey = dt.getFullYear();
          const em = String(dt.getMonth() + 1).padStart(2, '0');
          const ed = String(dt.getDate()).padStart(2, '0');
          endDate = `${ey}-${em}-${ed}`;
        } else if (trip.end_date && /^\d{4}-\d{2}-\d{2}$/.test(trip.end_date)) {
          endDate = trip.end_date;
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
          difficulty: trip.difficulty ? normalizeDifficulty(trip.difficulty) : ''
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
// PARSER: FONI (WordPress REST API + Cheerio Article & Text Fallback)
// ----------------------------------------------------
function parseFoni() {
  const apiFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('www_foni_org_gr_wp-json') && f.endsWith('.html'));
  const htmlPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.html');
  const altHtmlPath = path.join(INPUT_DIR, 'www_foni_org_gr_category-ekdromes.html');
  const txtPath = path.join(INPUT_DIR, 'foni_org_gr_category-ekdromes.txt');
  const defaultUrl = 'https://www.foni.org.gr/category/ekdromes/';
  const urlMap = {};
  const events = [];

  const extractFoniDifficulty = (descHtml) => {
    if (!descHtml) return '';
    const text = cheerio.load(descHtml).text().replace(/\s+/g, ' ');
    const matches = [...text.matchAll(/(?:βαθμ[οό]ς\s+δυσκολ[ιί]ας|Β\.?\s*Δ\.?|δυσκολ[ιί]α)\s*[:=]\s*([^\n.;,()]+)/gi)];
    if (matches.length === 0) return '';
    const order = ['1', '1+', 'Εύκολη', '2', '2+', 'Μέτρια', '3', '3+', '4', '5', '6', 'Δύσκολη', 'Απαιτητική'];
    const grades = new Set();
    for (const m of matches) {
      const raw = m[1].trim();
      const numMatch = raw.match(/^([1-6])\s*(\+)?/);
      if (numMatch) {
        grades.add(numMatch[1] + (numMatch[2] || ''));
        continue;
      }
      if (/^ε[υύ]κολ/i.test(raw)) grades.add('Εύκολη');
      else if (/^μ[εέ]τρι/i.test(raw)) grades.add('Μέτρια');
      else if (/^(?:δ[υύ]σκολ|απαιτητικ)/i.test(raw)) grades.add('Δύσκολη');
    }
    return Array.from(grades).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
  };

  const cleanFoniActivityPrefix = (afterSlash) => {
    return afterSlash
      .replace(/^(?:(?:καλοκαιριν[ήη]\s+)?πεζοπορικ[ήη](?:\s*(?:&|και|[-–—])\s*(?:αποκριατικ[ήη]|via\s+cordat+a|αγ[ώω]νας\s+ορεινο[ύυ]\s+τρεξ[ίι]ματος))?)\s*[:–-]\s*/i, '')
      .trim();
  };

  // Strategy 1: WordPress REST API (Primary - includes full post content & difficulty)
  for (const file of apiFiles) {
    const filePath = path.join(INPUT_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
      if (!rawContent.startsWith('[')) continue;
      const posts = JSON.parse(rawContent);
      for (const post of posts) {
        const rawTitle = cheerio.load(post.title?.rendered || '').text().trim();
        const bodyHtml = post.content?.rendered || '';
        const bodyText = cheerio.load(bodyHtml).text().replace(/\s+/g, ' ');
        const href = post.link || defaultUrl;

        const match = rawTitle.match(/^(.+?)\s+\/\s+(.+)$/i);
        if (!match) continue;

        const dateText = match[1].trim();
        const rawAfterSlash = match[2].trim();

        // Zero-false-positive non-hiking filter:
        // Only exclude when explicitly labeled a seminar or sightseeing trip AND devoid of any hiking/trail indicators
        const hasAnyHikeSignal = /πεζοπορ|ανάβαση|αναβαση|μονοπάτι|μονοπατι|υψομετρικ|μήκος διαδρομής|βαθμός δυσκολίας|δυσκολία\s*:|ώρες πορείας/i.test(rawTitle + ' ' + bodyText);
        const isSeminar = /^σεμιν[άα]ριο\b/i.test(rawAfterSlash);
        const isPureSightseeing = (/^(?:καλοκαιριν[ήη]\s+)?περιηγητικ[ήη](?:\s*[:–-])|περιηγητικ[ήη]\s+εκδρομ[ήη]/i.test(rawAfterSlash + ' ' + bodyText)) && !hasAnyHikeSignal;
        if (isSeminar || isPureSightseeing) continue;

        const eventTitle = cleanFoniActivityPrefix(rawAfterSlash);
        const parsed = parseDateRange(dateText);
        if (parsed && eventTitle.length >= 3 && !isSchoolTitle(eventTitle)) {
          events.push({
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            displayDate: parsed.displayDate,
            title: eventTitle,
            club: 'ΦΟΝΙ',
            url: href,
            difficulty: extractFoniDifficulty(bodyHtml)
          });
        }
      }
    } catch (e) {
      console.error(`Failed to parse FONI JSON API in ${file}:`, e.message);
    }
  }

  // Strategy 2: HTML DOM fallback
  const activeHtmlPath = fs.existsSync(htmlPath) ? htmlPath : (fs.existsSync(altHtmlPath) ? altHtmlPath : null);
  if (events.length === 0 && activeHtmlPath) {
    try {
      const html = fs.readFileSync(activeHtmlPath, 'utf-8');
      const $ = cheerio.load(html);
      $('article').each((i, el) => {
        const titleLink = $(el).find('.elementor-post__title a');
        const rawTitle = titleLink.text().trim();
        const href = titleLink.attr('href');
        if (rawTitle && href) {
          urlMap[rawTitle] = href;

          const match = rawTitle.match(/^(.+?)\s+\/\s+(.+)$/i);
          if (match) {
            const dateText = match[1].trim();
            const rawAfterSlash = match[2].trim();
            if (/^(?:σεμιν[άα]ριο|(?:καλοκαιριν[ήη]\s+)?περιηγητικ[ήη]\s*[:–-])/i.test(rawAfterSlash)) return;
            const eventTitle = cleanFoniActivityPrefix(rawAfterSlash);
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

      const match = line.match(/^(.+?)\s+\/\s+(?:[Α-Ωα-ωίϊΐόάέύώήώ\s,&]+\s*[:–-]\s*)?(.+)$/i);
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
// PARSER: EPOS Filis (Tribe Events REST API + Cheerio DOM Fallback)
// ----------------------------------------------------
function parseEposFilis() {
  const htmlFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('eposfilis_gr_') && f.endsWith('.html'));
  const txtFiles = fs.readdirSync(INPUT_DIR).filter(f => f.startsWith('eposfilis_gr_') && f.endsWith('.txt'));
  const defaultUrl = 'https://eposfilis.gr/events/category/%ce%b7%ce%bc%ce%b5%cf%81%ce%bf%ce%bb%cf%8c%ce%b3%ce%b9%ce%bf/';
  const events = [];

  const extractEposDifficulty = (descHtml) => {
    if (!descHtml) return '';
    const plainDesc = cheerio.load(descHtml).text().replace(/\s+/g, ' ');
    const matches = [...plainDesc.matchAll(/Β\.?\s*Δ\.?\s*[:=]?\s*([1-6]\+?(?:\s*(?:\/|ή|&|-)\s*[1-6]\+?)*)/gi)];
    if (matches.length === 0) return '';
    const order = ['1', '1+', '2', '2+', '3', '3+', '4', '4+', '5', '5+', '6'];
    const grades = new Set();
    for (const m of matches) {
      const tokens = m[1].split(/\/|ή|&|-/).map(t => t.trim()).filter(Boolean);
      tokens.forEach(t => grades.add(t));
    }
    const sorted = Array.from(grades).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return sorted.join(', ');
  };

  const cleanEposTitle = (rawTitle) => {
    const clean = rawTitle
      .replace(/^\d+(?:\s*[-–—]\s*\d+)?\s*\/\s*\d+(?:\/\d{2,4})?\s*(?:[-–—]\s*\d+(?:\s*[-–—]\s*\d+)?\s*\/\s*\d+(?:\/\d{2,4})?)?\s*/, '')
      .replace(/^(?:Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή)\s*/i, '')
      .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || rawTitle;
  };

  // Strategy 1: Tribe Events REST API JSON files (Primary - includes full description & Β.Δ.)
  const apiFiles = htmlFiles.filter(f => f.includes('wp-json-tribe-events'));
  for (const file of apiFiles) {
    const filePath = path.join(INPUT_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
      if (!rawContent.startsWith('{')) continue;
      const data = JSON.parse(rawContent);
      const apiEvents = Array.isArray(data.events) ? data.events : [];
      for (const ev of apiEvents) {
        const startDate = (ev.start_date || '').slice(0, 10);
        const endDate = (ev.end_date || ev.start_date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) continue;

        const [, sMonth, sDay] = startDate.split('-');
        const [, eMonth, eDay] = endDate.split('-');
        let displayDate = '';
        if (startDate === endDate) {
          displayDate = `${parseInt(sDay, 10)}/${parseInt(sMonth, 10)}`;
        } else if (sMonth === eMonth) {
          displayDate = `${parseInt(sDay, 10)}-${parseInt(eDay, 10)}/${parseInt(sMonth, 10)}`;
        } else {
          displayDate = `${parseInt(sDay, 10)}/${parseInt(sMonth, 10)} - ${parseInt(eDay, 10)}/${parseInt(eMonth, 10)}`;
        }

        const decodedTitle = cheerio.load(ev.title || '').text().trim();
        const cleanTitle = cleanEposTitle(decodedTitle);
        if (cleanTitle.length < 3 || isSchoolTitle(cleanTitle)) continue;

        events.push({
          startDate,
          endDate,
          displayDate,
          title: cleanTitle,
          club: 'ΕΠΟΣ Φυλής',
          url: ev.url || defaultUrl,
          difficulty: extractEposDifficulty(ev.description || '')
        });
      }
    } catch (e) {
      console.error(`Failed to parse EPOS Filis JSON API in ${file}:`, e.message);
    }
  }

  const parseMonthName = (mStr) => {
    const clean = stripGreekAccents((mStr || '').toLowerCase().trim());
    const map = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12',
      'ιανουαριος': '01', 'φεβρουαριος': '02', 'μαρτιος': '03', 'απριλιος': '04',
      'μαιος': '05', 'ιουνιος': '06', 'ιουλιος': '07', 'αυγουστος': '08',
      'σεπτεμβριος': '09', 'οκτωβριος': '10', 'νοεμβριος': '11', 'δεκεμβριος': '12'
    };
    return map[clean] || parseGreekMonth(clean) || parseEnglishMonth(clean) || null;
  };

  // Strategy 2: Cheerio HTML DOM parsing on Tribe Events markup across fetched HTML pages (Fallback)
  if (events.length === 0) {
    for (const file of htmlFiles.filter(f => !f.includes('wp-json-tribe-events'))) {
    const htmlPath = path.join(INPUT_DIR, file);
    if (!fs.existsSync(htmlPath)) continue;
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

        const multiMonthMatch = dateText.match(/([a-zA-ZΑ-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d+)(?:,\s*(\d{4}))?\s*@.+?-\s*([a-zA-ZΑ-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d+)(?:,\s*(\d{4}))?/i);
        const sameMonthMultiDayMatch = dateText.match(/([a-zA-ZΑ-Ωα-ωίϊΐόάέύώήώ]+)\s+(\d+)(?:,\s*(\d{4}))?\s*@.+?-\s*(?:[a-zA-ZΑ-Ωα-ωίϊΐόάέύώήώ]+\s+)?(\d+)(?:,\s*(\d{4}))?\s*@/i);
        
        if (multiMonthMatch) {
          const sMonth = parseMonthName(multiMonthMatch[1]);
          const sDay = multiMonthMatch[2].padStart(2, '0');
          const sYear = multiMonthMatch[3] || (startDate ? startDate.split('-')[0] : resolveEventYear(sMonth));
          const eMonth = parseMonthName(multiMonthMatch[4]);
          const eDay = multiMonthMatch[5].padStart(2, '0');
          const eYear = multiMonthMatch[6] || (parseInt(eMonth, 10) < parseInt(sMonth, 10) ? String(parseInt(sYear, 10) + 1) : sYear);

          startDate = `${sYear}-${sMonth}-${sDay}`;
          endDate = `${eYear}-${eMonth}-${eDay}`;
          displayDate = sMonth === eMonth
            ? `${parseInt(sDay, 10)}-${parseInt(eDay, 10)}/${parseInt(sMonth, 10)}`
            : `${parseInt(sDay, 10)}/${parseInt(sMonth, 10)} - ${parseInt(eDay, 10)}/${parseInt(eMonth, 10)}`;
        } else if (sameMonthMultiDayMatch) {
          const sMonth = parseMonthName(sameMonthMultiDayMatch[1]);
          const sDay = sameMonthMultiDayMatch[2].padStart(2, '0');
          const sYear = sameMonthMultiDayMatch[3] || (startDate ? startDate.split('-')[0] : resolveEventYear(sMonth));
          const eDay = sameMonthMultiDayMatch[4].padStart(2, '0');
          const eYear = sameMonthMultiDayMatch[5] || sYear;

          startDate = `${sYear}-${sMonth}-${sDay}`;
          endDate = `${eYear}-${sMonth}-${eDay}`;
          displayDate = `${parseInt(sDay, 10)}-${parseInt(eDay, 10)}/${parseInt(sMonth, 10)}`;
        } else if (startDate) {
          const [y, m, d] = startDate.split('-');
          displayDate = `${parseInt(d, 10)}/${parseInt(m, 10)}`;
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
      console.error(`Failed to parse EPOS Filis HTML DOM in ${file}:`, e.message);
    }
    }
  }

  // Strategy 3: Text regex parsing fallback if Strategies 1 & 2 yield 0 events
  if (events.length === 0 && txtFiles.length > 0) {
    for (const file of txtFiles) {
      const txtPath = path.join(INPUT_DIR, file);
      if (!fs.existsSync(txtPath)) continue;
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
            displayDate = `${parseInt(sDay, 10)}-${parseInt(eDay, 10)}/${parseInt(monthNum, 10)}`;
          } else {
            startDate = `${year}-${monthNum}-${dateStr.padStart(2, '0')}`;
            endDate = `${year}-${monthNum}-${dateStr.padStart(2, '0')}`;
            displayDate = `${parseInt(dateStr, 10)}/${parseInt(monthNum, 10)}`;
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
    let contextYear = null;
    let lastSeenMonth = 0;

    $('.gdlr-core-accordion-item-tab').each((i, el) => {
      const dateHead = $(el).find('.gdlr-core-head').text().trim();
      
      const titleEl = $(el).find('.gdlr-core-accordion-item-title').clone();
      titleEl.find('.gdlr-core-head').remove();
      const rawTitle = titleEl.text().trim();

      const contentText = $(el).find('.gdlr-core-accordion-item-content').text().trim();

      if (!dateHead && !rawTitle) return;

      const fullDateStr = dateHead || rawTitle;
      const explicit4DigitYear = fullDateStr.match(/(20\d{2})/);
      if (explicit4DigitYear) {
        contextYear = explicit4DigitYear[1];
      }

      const parsedDate = parseDateRange(fullDateStr, contextYear);
      if (parsedDate && parsedDate.startDate) {
        const sMonthNum = parseInt(parsedDate.startDate.split('-')[1], 10);
        if (!explicit4DigitYear && lastSeenMonth === 12 && sMonthNum === 1 && contextYear) {
          contextYear = String(parseInt(contextYear, 10) + 1);
          const reparsed = parseDateRange(fullDateStr, contextYear);
          if (reparsed) {
            parsedDate.startDate = reparsed.startDate;
            parsedDate.endDate = reparsed.endDate;
            parsedDate.displayDate = reparsed.displayDate;
          }
        }
        lastSeenMonth = sMonthNum;
        if (!contextYear) {
          contextYear = parsedDate.startDate.split('-')[0];
        }
      }

      let difficulty = '';
      const bdMatch = contentText.match(/Β\.?\s*Δ\.?\s*:\s*([0-9+]+(?:\s*(?:[-–—&]|ή)\s*[0-9+]+)*)/i);
      if (bdMatch) {
        difficulty = normalizeDifficulty(bdMatch[1]);
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
    let contextYear = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(/(?:[Α-Ωα-ω\s]+)?(\d{1,2}(?:[\.\/]\d{1,2})?(?:\s*[-–—]\s*\d{1,2}[\.\/]\d{1,2})?[\.\/]\d{2,4})\s*(.*)/i);
      if (match) {
        const dateStr = match[1];
        const restTitle = match[2];
        const explicit4DigitYear = dateStr.match(/(20\d{2})/);
        if (explicit4DigitYear) {
          contextYear = explicit4DigitYear[1];
        }
        const parsedDate = parseDateRange(dateStr, contextYear);

        let difficulty = '';
        for (let j = 1; j <= 3; j++) {
          if (i + j < lines.length) {
            const nextLine = lines[i + j].trim();
            const bdMatch = nextLine.match(/Β\.?\s*Δ\.?\s*:\s*([0-9+]+(?:\s*(?:[-–—&]|ή)\s*[0-9+]+)*)/i);
            if (bdMatch) {
              difficulty = normalizeDifficulty(bdMatch[1]);
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

  const BASELINE_FILE = path.join(__dirname, '..', 'src', 'data', 'health-baseline.json');
  let baselineData = {};
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      baselineData = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse health-baseline.json');
    }
  }

  const addClubEvents = (club, parsedList) => {
    const clubUrls = CLUB_URLS[club] || [];
    const anyUrlFailed = fetchReport && clubUrls.some(u => {
      const r = fetchReport[u];
      return !r || (!r.success && !r.ok);
    });

    if (parsedList && parsedList.length > 0) {
      let mergedList = [...parsedList];
      if (anyUrlFailed && baselineData[club] && baselineData[club].length > 0) {
        const activeBase = baselineData[club].filter(e => {
          const evEndDate = new Date(e.endDate || e.startDate);
          const evStartDate = new Date(e.startDate);
          return evEndDate >= TODAY || evStartDate >= TODAY;
        });
        const existingKeys = new Set(mergedList.map(e => `${e.startDate}_${e.title}`));
        const recovered = activeBase.filter(e => !existingKeys.has(`${e.startDate}_${e.title}`));
        if (recovered.length > 0) {
          console.warn(`⚠️ [PARTIAL RESILIENCE FALLBACK] ${club} had a partial URL fetch failure. Merged ${recovered.length} active baseline events with ${parsedList.length} parsed events.`);
          mergedList = mergedList.concat(recovered);
          allEvents = allEvents.concat(mergedList);
          addLog(club, 'warning', `${parsedList.length} parsed (partial fetch error) - preserved ${recovered.length} healthy events`);
          return;
        }
      }
      allEvents = allEvents.concat(mergedList);
      addLog(club, 'success', mergedList.length);
    } else if (baselineData[club] && baselineData[club].length > 0) {
      const activeBase = baselineData[club].filter(e => {
        const evEndDate = new Date(e.endDate || e.startDate);
        const evStartDate = new Date(e.startDate);
        return evEndDate >= TODAY || evStartDate >= TODAY;
      });
      if (activeBase.length > 0) {
        console.warn(`⚠️ [RESILIENCE FALLBACK] ${club} yielded 0 newly parsed events (e.g. anti-bot challenge or server down). Preserving ${activeBase.length} active events from healthy baseline!`);
        allEvents = allEvents.concat(activeBase);
        addLog(club, 'warning', `0 parsed (bot challenge/network error) - preserved ${activeBase.length} healthy events`);
        return;
      }
      addLog(club, 'error', 0);
    } else {
      addLog(club, 'error', 0);
    }
  };

  try {
    const acharnon = parseEosAcharnon();
    console.log(`Parsed ${acharnon.length} events from EOS Acharnon`);
    addClubEvents('ΕΟΣ Αχαρνών', acharnon);
  } catch (e) {
    console.error('Error parsing EOS Acharnon:', e.message);
    addClubEvents('ΕΟΣ Αχαρνών', []);
  }

  try {
    const aos = parseAos();
    console.log(`Parsed ${aos.length} events from AOS`);
    addClubEvents('ΑΟΣ', aos);
  } catch (e) {
    console.error('Error parsing AOS:', e.message);
    addClubEvents('ΑΟΣ', []);
  }

  try {
    const poa = parsePoa();
    console.log(`Parsed ${poa.length} events from POA`);
    addClubEvents('ΠΟΑ', poa);
  } catch (e) {
    console.error('Error parsing POA:', e.message);
    addClubEvents('ΠΟΑ', []);
  }

  try {
    const athinon = parseEosAthinon();
    console.log(`Parsed ${athinon.length} events from EOS Athinon`);
    addClubEvents('ΕΟΣ Αθηνών', athinon);
  } catch (e) {
    console.error('Error parsing EOS Athinon:', e.message);
    addClubEvents('ΕΟΣ Αθηνών', []);
  }

  try {
    const hlioupolis = parseEosHalioupolis();
    console.log(`Parsed ${hlioupolis.length} events from EOS Hlioupolis`);
    addClubEvents('ΕΟΣ Ηλιούπολης', hlioupolis);
  } catch (e) {
    console.error('Error parsing EOS Hlioupolis:', e.message);
    addClubEvents('ΕΟΣ Ηλιούπολης', []);
  }

  try {
    const foni = parseFoni();
    console.log(`Parsed ${foni.length} events from FONI`);
    addClubEvents('ΦΟΝΙ', foni);
  } catch (e) {
    console.error('Error parsing FONI:', e.message);
    addClubEvents('ΦΟΝΙ', []);
  }

  try {
    const filis = parseEposFilis();
    console.log(`Parsed ${filis.length} events from EPOS Filis`);
    addClubEvents('ΕΠΟΣ Φυλής', filis);
  } catch (e) {
    console.error('Error parsing EPOS Filis:', e.message);
    addClubEvents('ΕΠΟΣ Φυλής', []);
  }

  try {
    const fop = parseFop();
    console.log(`Parsed ${fop.length} events from FOP`);
    addClubEvents('ΦΟΠ', fop);
  } catch (e) {
    console.error('Error parsing FOP:', e.message);
    addClubEvents('ΦΟΠ', []);
  }

  // Filter out invalid dates, training schools (Σχολές), and keep only upcoming / current events (endDate >= TODAY or startDate >= TODAY)
  allEvents = allEvents.filter(e => {
    if (!e.startDate || e.startDate === 'NaN-NaN-NaN' || !/^\d{4}-\d{2}-\d{2}$/.test(e.startDate)) return false;
    if (isSchoolTitle(e.title)) return false;
    const evEndDate = new Date(e.endDate || e.startDate);
    const evStartDate = new Date(e.startDate);
    return evEndDate >= TODAY || evStartDate >= TODAY;
  });

  // Global Smarter Deduplication
  const dedupedEvents = [];
  for (const ev of allEvents) {
    const t1 = stripGreekAccents(ev.title).toLowerCase().trim();
    const words1 = getSignificantWords(ev.title);
    const evHasFrag = ev.url.includes('#:~:text=');

    const duplicate = dedupedEvents.find(u => {
      if (u.club !== ev.club || u.startDate !== ev.startDate) return false;

      const t2 = stripGreekAccents(u.title).toLowerCase().trim();
      const words2 = getSignificantWords(u.title);
      const overlap = words1.filter(w => words2.includes(w)).length;

      const uHasFrag = u.url.includes('#:~:text=');
      const isSameDedicatedUrl = !evHasFrag && !uHasFrag && ev.url === u.url && !ev.url.endsWith('/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/');
      const isSubset = t1.includes(t2) || t2.includes(t1);
      const minWords = Math.min(words1.length, words2.length);
      const isWordMatch = minWords > 0 && overlap >= 1 && (overlap / minWords) >= 0.4;

      if (u.endDate === ev.endDate) {
        return isSameDedicatedUrl || isSubset || isWordMatch;
      }
      // Also deduplicate if endDate differs slightly (e.g. single-day summary vs multi-day detail) when URL or title clearly matches
      return isSameDedicatedUrl || isSubset || (minWords >= 2 && (overlap / minWords) >= 0.6);
    });

    if (duplicate) {
      const t2 = stripGreekAccents(duplicate.title).toLowerCase().trim();
      const words2 = getSignificantWords(duplicate.title);
      const isSubset = t1.includes(t2) || t2.includes(t1);

      if (isSubset) {
        // Keep shorter clean title ONLY if it has at least 2 significant words; never overwrite a descriptive title with a 1-word generic mountain name
        if (ev.title.length < duplicate.title.length && words1.length >= 2) {
          duplicate.title = ev.title;
        } else if (duplicate.title.length < ev.title.length && words2.length < 2 && words1.length >= 2) {
          duplicate.title = ev.title;
        }
      } else if (ev.title.length > duplicate.title.length) {
        duplicate.title = ev.title;
      }

      if (ev.endDate > duplicate.endDate) {
        duplicate.endDate = ev.endDate;
        duplicate.displayDate = ev.displayDate;
      }

      if (!duplicate.difficulty && ev.difficulty) {
        duplicate.difficulty = ev.difficulty;
      }

      const dupHasFrag = duplicate.url.includes('#:~:text=');
      if (!evHasFrag && dupHasFrag) {
        duplicate.url = ev.url;
      } else if (evHasFrag && dupHasFrag && ev.url.length > duplicate.url.length) {
        duplicate.url = ev.url;
      }
      continue;
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
