import crypto from 'crypto';

const athensFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const GREEK_STOPWORDS = new Set([
  'και', 'του', 'της', 'των', 'τον', 'την', 'στο', 'στα', 'στον', 'στην', 'στη',
  'στους', 'στις', 'εως', 'απο', 'για', 'αρα', 'εχει', 'μας', 'με', 'σε', 'το',
  'τα', 'οι', 'τις', 'τους', 'ενα', 'μια', 'που', 'οτι', 'περι', 'υπο', 'προς'
]);

const GENERIC_NON_DEDICATED_PATTERNS = [
  /^https?:\/\/(?:www\.)?fop\.gr\/?$/i,
  /^https?:\/\/(?:www\.)?poa\.gr\/index\.php\/programma\/?$/i,
  /^https?:\/\/(?:www\.)?aos\.gr\/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis\/?$/i,
  /^https?:\/\/(?:www\.)?aos\.gr\/programma-[^/]+\/?$/i,
  /^https?:\/\/(?:www\.)?eosathinon\.gr\/anavaseis\/programma\/?$/i,
  /^https?:\/\/(?:www\.)?eosathinon\.gr\/anavaseis\/anavaseis-exoterikoy\/?$/i,
  /^https?:\/\/(?:www\.)?eosh\.gr\/expeditions\/?$/i,
  /^https?:\/\/(?:www\.)?eosacharnon\.xmiddleware\.com\/el(?:\/booking)?\/?$/i,
  /^https?:\/\/(?:www\.)?eposfilis\.gr\/events\/category\/.*$/i,
  /^https?:\/\/(?:www\.)?foni\.org\.gr\/category\/ekdromes\/?$/i
];

export function getAthensToday(now = new Date()) {
  return athensFormatter.format(now);
}

export function stripGreekAccents(str = '') {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ');
}

export function normalizeTitle(title = '') {
  return stripGreekAccents(title).replace(/[^a-z0-9\u0370-\u03ff]/g, '');
}

export function cleanWord(word = '') {
  return stripGreekAccents(word).replace(/[^a-z0-9\u0370-\u03ff]/g, '').trim();
}

export function getSignificantWords(text = '') {
  if (!text) return [];
  return String(text)
    .split(/[\s\-–—/(),.:;«»"'()]+/)
    .map(cleanWord)
    .filter(w => w.length > 2 && !GREEK_STOPWORDS.has(w));
}

function boundedLevenshtein1(a, b) {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;
  if (a === b) return true;

  let i = 0;
  let j = 0;
  let diffs = 0;
  while (i < lenA && j < lenB) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      diffs++;
      if (diffs > 1) return false;
      if (lenA > lenB) {
        i++;
      } else if (lenB > lenA) {
        j++;
      } else {
        i++;
        j++;
      }
    }
  }
  if (i < lenA || j < lenB) diffs++;
  return diffs <= 1;
}

/**
 * Tolerates Greek case inflections (e.g. φλαμπουριτσα / φλαμπουριτσας, πυργος / πυργου)
 * and 1-char spelling variants (e.g. ζηρια / ζηρεια) for words of length >= 5.
 */
export function areGreekWordsSimilar(wordA = '', wordB = '') {
  if (!wordA || !wordB) return false;
  if (wordA === wordB) return true;
  const minLen = Math.min(wordA.length, wordB.length);
  const maxLen = Math.max(wordA.length, wordB.length);
  if (minLen < 5) return false;
  if (maxLen - minLen <= 2 && (wordA.startsWith(wordB) || wordB.startsWith(wordA))) {
    return true;
  }
  // Common Greek 2-char case suffix swaps on the same stem (e.g. πυργος vs πυργου, ρεματα vs ρεματος)
  if (minLen >= 6 && Math.abs(wordA.length - wordB.length) <= 1) {
    const stemLen = minLen - 2;
    if (stemLen >= 4 && wordA.slice(0, stemLen) === wordB.slice(0, stemLen)) {
      return true;
    }
  }
  return boundedLevenshtein1(wordA, wordB);
}

export function isValidCalendarDate(dateStr = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return false;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function normalizeUrl(url = '') {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    let pathname = u.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '/';
    const search = u.search || '';
    const hash = u.hash || '';
    return `${u.protocol.toLowerCase()}//${host}${pathname}${search}${hash}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function isDedicatedEventUrl(url = '', extraGenericUrls = []) {
  const trimmed = String(url || '').trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed.includes(':~:text=')) return false;

  const withoutHash = trimmed.split('#')[0];
  for (const pattern of GENERIC_NON_DEDICATED_PATTERNS) {
    if (pattern.test(withoutHash)) return false;
  }

  if (extraGenericUrls && extraGenericUrls.length > 0) {
    const norm = normalizeUrl(withoutHash);
    for (const g of extraGenericUrls) {
      if (norm === normalizeUrl(String(g || '').split('#')[0])) {
        return false;
      }
    }
  }

  return true;
}

export function getEventAnchor(ev) {
  const club = (ev.club || '').trim();
  const startDate = (ev.startDate || '').trim();
  const title = (ev.title || '').trim();
  const hash = crypto
    .createHash('sha256')
    .update(`${club}::${startDate}::${title}`)
    .digest('hex')
    .slice(0, 8);
  return `ev-${startDate}-${hash}`;
}

export function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeMarkdownLinkText(str = '') {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function formatEventDate(ev, currentYear = getAthensToday().slice(0, 4)) {
  const startYear = ev?.startDate ? String(ev.startDate).substring(0, 4) : '';
  const isFutureYear = Boolean(startYear && currentYear && startYear !== currentYear);

  let dateStr = ev?.displayDate || ev?.startDate || '';
  if (isFutureYear && !dateStr.includes(startYear) && !dateStr.includes(`/${startYear.slice(2)}`)) {
    dateStr += `/${startYear}`;
  }
  return dateStr;
}

/**
 * Splits a single oversized line safely on whitespace/character boundaries without
 * cutting inside an HTML tag (<...>) or entity (&...;).
 */
function splitOversizedLine(line, maxLen) {
  if (line.length <= maxLen) return [line];
  const pieces = [];
  let remaining = line;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt <= Math.floor(maxLen * 0.4)) {
      splitAt = maxLen;
    }
    // Avoid splitting inside an HTML tag (<...>)
    const lastOpen = remaining.lastIndexOf('<', splitAt);
    const lastClose = remaining.lastIndexOf('>', splitAt);
    if (lastOpen > lastClose && lastOpen > 0) {
      splitAt = lastOpen;
    }
    // Avoid splitting inside an HTML entity (&amp; etc.)
    const lastAmp = remaining.lastIndexOf('&', splitAt);
    const lastSemi = remaining.lastIndexOf(';', splitAt);
    if (lastAmp > lastSemi && splitAt - lastAmp < 10 && lastAmp > 0) {
      splitAt = lastAmp;
    }
    if (splitAt <= 0) splitAt = maxLen;
    pieces.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

/**
 * Splits a Telegram HTML message cleanly along line/block boundaries so every chunk
 * stays safely below Telegram's 4,096-character limit without breaking HTML tags.
 */
export function chunkTelegramBlocks(header, blocks, footer = '', maxLen = 3900) {
  const cleanBlocks = (blocks || []).filter(Boolean);
  const fullBody = [header, cleanBlocks.join('\n'), footer].filter(Boolean).join('\n\n');
  if (fullBody.length <= maxLen) {
    return [fullBody];
  }

  const chunks = [];
  let currentBlocks = [];

  const formatBodyBlocks = (bodyBlocks) => {
    if (bodyBlocks.length === 0) return '';
    return bodyBlocks
      .map((b, idx) => (idx === 0 ? String(b).replace(/^\n+/, '') : b))
      .join('\n');
  };

  const buildChunk = (partNum, hasMultipleParts, bodyBlocks, includeFooter) => {
    const partSuffix = hasMultipleParts ? ` (Μέρος ${partNum})` : '';
    const chunkHeader = partNum === 1
      ? `${header}${partSuffix}`
      : `<b>Συνέχεια ενημέρωσης${partSuffix}:</b>`;
    const parts = [chunkHeader, formatBodyBlocks(bodyBlocks)];
    if (includeFooter && footer) parts.push(footer);
    return parts.filter(Boolean).join('\n\n');
  };

  for (const rawBlock of cleanBlocks) {
    const candidateBlocks = [...currentBlocks, rawBlock];
    const partNum = chunks.length + 1;
    // Reserve space for footer on the current chunk so the final chunk never overflows
    const tentative = buildChunk(partNum, true, candidateBlocks, true);

    if (tentative.length > maxLen && currentBlocks.length > 0) {
      chunks.push(buildChunk(partNum, true, currentBlocks, false));
      currentBlocks = [rawBlock];
    } else {
      currentBlocks = candidateBlocks;
    }
  }

  if (currentBlocks.length > 0) {
    const finalChunk = buildChunk(chunks.length + 1, chunks.length > 0, currentBlocks, true);
    if (finalChunk.length <= maxLen) {
      chunks.push(finalChunk);
    } else {
      // Defensive fallback if a single huge block + header + footer exceeds maxLen
      chunks.push(...chunkHtmlText(finalChunk, maxLen));
    }
  }

  return chunks;
}

/**
 * Splits a generic multi-paragraph HTML message (like an Admin Alert) cleanly on newline
 * boundaries while preserving safety under Telegram's 4,096-character limit.
 */
export function chunkHtmlText(htmlText, maxLen = 3900) {
  const text = String(htmlText || '').trim();
  if (!text) return [];
  if (text.length <= maxLen) return [text];

  const lines = text.split('\n').flatMap(l => (l.length > maxLen ? splitOversizedLine(l, maxLen) : [l]));
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
