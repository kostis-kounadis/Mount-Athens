import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAthensToday,
  normalizeTitle,
  getSignificantWords,
  areGreekWordsSimilar,
  normalizeUrl,
  isDedicatedEventUrl,
  getEventAnchor,
  escapeHtml,
  escapeMarkdownLinkText,
  formatEventDate,
  chunkTelegramBlocks,
  chunkHtmlText
} from './lib/event-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PATHS = {
  eventsFile: path.join(__dirname, '../src/data/events.json'),
  ledgerFile: path.join(__dirname, '../src/data/notified-events.json'),
  statusFile: path.join(__dirname, '../src/data/status.json'),
  clubHealthFile: path.join(__dirname, '../src/data/club-health.json'),
  anomalyReportFile: path.join(__dirname, '../src/data/anomaly_report.md'),
  localSummaryFile: path.join(__dirname, '../_input/last_sync_summary.md')
};

const SITE_URL = 'https://kostis-kounadis.github.io/Mount-Athens/';
const LEDGER_RETENTION_DAYS = 7;

function loadJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[notifications] Failed to parse ${path.basename(filePath)}:`, err.message);
    return fallback;
  }
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(`${dateStrA}T00:00:00Z`).getTime();
  const b = new Date(`${dateStrB}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return Infinity;
  return Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)));
}

function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeDiffForCompare(diff = '') {
  return String(diff || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function titleSimilarityStats(titleA, titleB) {
  const wordsA = new Set(getSignificantWords(titleA));
  const wordsB = new Set(getSignificantWords(titleB));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  const minSize = Math.min(wordsA.size, wordsB.size);
  const maxSize = Math.max(wordsA.size, wordsB.size);
  const symDiff = union - intersection;
  return {
    wordsA,
    wordsB,
    intersection,
    union,
    minSize,
    maxSize,
    symDiff,
    jaccard: union > 0 ? intersection / union : 0,
    minOverlapRatio: minSize > 0 ? intersection / minSize : 0
  };
}

function fuzzyTitleSimilarityStats(titleA, titleB) {
  const wordsA = [...new Set(getSignificantWords(titleA))];
  const wordsB = [...new Set(getSignificantWords(titleB))];
  const matchedB = new Set();
  let matched = 0;

  // Prefer exact matches first, then fuzzy Greek stem/typo matches
  const unmatchedA = [];
  for (const wA of wordsA) {
    const exactIdx = wordsB.findIndex((wB, idx) => !matchedB.has(idx) && wA === wB);
    if (exactIdx !== -1) {
      matchedB.add(exactIdx);
      matched++;
    } else {
      unmatchedA.push(wA);
    }
  }
  for (const wA of unmatchedA) {
    const fuzzyIdx = wordsB.findIndex((wB, idx) => !matchedB.has(idx) && areGreekWordsSimilar(wA, wB));
    if (fuzzyIdx !== -1) {
      matchedB.add(fuzzyIdx);
      matched++;
    }
  }

  const onlyInPrev = wordsA.length - matched;
  const onlyInCurr = wordsB.length - matched;
  const symDiff = onlyInPrev + onlyInCurr;
  const union = matched + symDiff;
  return {
    wordsA,
    wordsB,
    matched,
    onlyInPrev,
    onlyInCurr,
    symDiff,
    union,
    jaccard: union > 0 ? matched / union : 0
  };
}

/**
 * Determines whether a matched (previous -> current) event underwent a
 * user-meaningful change worth alerting subscribers about (date, difficulty,
 * or substantive route/title update) vs minor scraper/punctuation/spelling noise.
 */
export function classifyEventChange(prev, curr, currentYear) {
  const prevEnd = prev.endDate || prev.startDate;
  const currEnd = curr.endDate || curr.startDate;
  const dateChanged = prev.startDate !== curr.startDate || prevEnd !== currEnd;

  const oldDiffNorm = normalizeDiffForCompare(prev.difficulty);
  const newDiffNorm = normalizeDiffForCompare(curr.difficulty);
  // Only alert difficulty change when an existing known difficulty actually changed
  // (filling in a previously blank difficulty "" -> "2" is silent metadata enrichment).
  const difficultyChanged = Boolean(oldDiffNorm && newDiffNorm && oldDiffNorm !== newDiffNorm);

  const normPrevTitle = normalizeTitle(prev.title);
  const normCurrTitle = normalizeTitle(curr.title);
  let titleChanged = false;
  if (normPrevTitle !== normCurrTitle) {
    const stats = fuzzyTitleSimilarityStats(prev.title, curr.title);
    // Pure shortening/abbreviation of the exact same hike (e.g. calendar summary vs full post)
    // is not a route change when no new words were introduced.
    const isPureAbbreviation = stats.onlyInCurr === 0 && stats.matched >= 2 && stats.wordsB.length < stats.wordsA.length;
    if (!isPureAbbreviation) {
      const isMajorRewriteOrExpansion = stats.symDiff >= 3 && stats.jaccard < 0.70;
      const isDestinationSwap = stats.onlyInPrev >= 1 && stats.onlyInCurr >= 1 && stats.jaccard <= 0.55;
      titleChanged = isMajorRewriteOrExpansion || isDestinationSwap;
    }
  }

  const isSignificant = dateChanged || difficultyChanged || titleChanged;
  return {
    isSignificant,
    dateChanged,
    difficultyChanged,
    titleChanged,
    oldDateStr: formatEventDate(prev, currentYear),
    newDateStr: formatEventDate(curr, currentYear),
    oldDifficulty: prev.difficulty || '',
    newDifficulty: curr.difficulty || '',
    oldTitle: prev.title || '',
    newTitle: curr.title || ''
  };
}

export function createLedgerEntry(ev, nowIso, status = 'active', existingFirstNotifiedAt = null) {
  return {
    club: ev.club,
    startDate: ev.startDate,
    endDate: ev.endDate || ev.startDate,
    displayDate: ev.displayDate || ev.startDate,
    title: ev.title,
    url: ev.url || '',
    difficulty: ev.difficulty || '',
    status,
    firstNotifiedAt: existingFirstNotifiedAt || nowIso,
    lastUpdatedAt: nowIso
  };
}

export function sortLedgerEntries(entries) {
  return [...entries].sort((a, b) => {
    const startCmp = String(a.startDate || '').localeCompare(String(b.startDate || ''));
    if (startCmp !== 0) return startCmp;
    const endCmp = String(a.endDate || '').localeCompare(String(b.endDate || ''));
    if (endCmp !== 0) return endCmp;
    const clubCmp = String(a.club || '').localeCompare(String(b.club || ''), 'el');
    if (clubCmp !== 0) return clubCmp;
    const titleCmp = String(a.title || '').localeCompare(String(b.title || ''), 'el');
    if (titleCmp !== 0) return titleCmp;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
}

/**
 * Matches a single healthy club's current upcoming events against its ledger
 * entries using a 4-pass matcher and classifies additions, substantive changes,
 * cancellations, and silent updates.
 */
export function diffClubEvents({
  club,
  currentEvents,
  ledgerEntries,
  todayStr,
  nowIso,
  suppressCancellations = false,
  allowMassCancel = false
}) {
  const currentYear = todayStr.slice(0, 4);
  const cutoffDate = subtractDays(todayStr, LEDGER_RETENTION_DAYS);

  const upcomingCurrent = currentEvents.filter(ev => ev && ev.startDate && (ev.endDate || ev.startDate) >= todayStr);
  const allActiveLedger = ledgerEntries.filter(ev => ev.status === 'active');
  const pastActiveLedger = allActiveLedger.filter(ev => (ev.endDate || ev.startDate) < todayStr);
  const activeLedger = allActiveLedger.filter(ev => (ev.endDate || ev.startDate) >= todayStr);
  const cancelledLedger = ledgerEntries.filter(ev => ev.status === 'cancelled' && (ev.endDate || ev.startDate) >= cutoffDate);

  const matchedCurrentIdx = new Set();
  const matchedActiveIdx = new Set();
  const pairs = []; // { prevIdx, currIdx }

  // Pass 1: Exact dedicated per-event URL match (prefers exact date+title match first to handle duplicate-URL recovery cleanly)
  const dedicatedUrlCandidates = [];
  for (let c = 0; c < upcomingCurrent.length; c++) {
    const curr = upcomingCurrent[c];
    if (!isDedicatedEventUrl(curr.url)) continue;
    const currNormUrl = normalizeUrl(curr.url);
    const currNormTitle = normalizeTitle(curr.title);

    for (let p = 0; p < activeLedger.length; p++) {
      const prev = activeLedger[p];
      if (!isDedicatedEventUrl(prev.url)) continue;
      if (normalizeUrl(prev.url) === currNormUrl) {
        let score = 1;
        if (prev.startDate === curr.startDate) score += 1;
        if (normalizeTitle(prev.title) === currNormTitle) score += 1;
        dedicatedUrlCandidates.push({ prevIdx: p, currIdx: c, score });
      }
    }
  }
  dedicatedUrlCandidates.sort((a, b) => b.score - a.score);
  for (const cand of dedicatedUrlCandidates) {
    if (matchedCurrentIdx.has(cand.currIdx) || matchedActiveIdx.has(cand.prevIdx)) continue;
    matchedCurrentIdx.add(cand.currIdx);
    matchedActiveIdx.add(cand.prevIdx);
    pairs.push({ prevIdx: cand.prevIdx, currIdx: cand.currIdx });
  }

  // Pass 2: Same startDate + exact normalized title (handles URL slug edits & non-dedicated URLs)
  for (let c = 0; c < upcomingCurrent.length; c++) {
    if (matchedCurrentIdx.has(c)) continue;
    const curr = upcomingCurrent[c];
    const currNormTitle = normalizeTitle(curr.title);

    for (let p = 0; p < activeLedger.length; p++) {
      if (matchedActiveIdx.has(p)) continue;
      const prev = activeLedger[p];
      if (prev.startDate === curr.startDate && normalizeTitle(prev.title) === currNormTitle) {
        matchedCurrentIdx.add(c);
        matchedActiveIdx.add(p);
        pairs.push({ prevIdx: p, currIdx: c });
        break;
      }
    }
  }

  // Pass 3: Same startDate + strong title similarity (greedy best-score; does NOT match unrelated same-date replacements)
  const sameDateCandidates = [];
  for (let c = 0; c < upcomingCurrent.length; c++) {
    if (matchedCurrentIdx.has(c)) continue;
    const curr = upcomingCurrent[c];
    const currNormTitle = normalizeTitle(curr.title);

    for (let p = 0; p < activeLedger.length; p++) {
      if (matchedActiveIdx.has(p)) continue;
      const prev = activeLedger[p];
      if (prev.startDate !== curr.startDate) continue;

      const prevNormTitle = normalizeTitle(prev.title);
      const shorterLen = Math.min(currNormTitle.length, prevNormTitle.length);
      const isSubset = shorterLen >= 6 && (currNormTitle.includes(prevNormTitle) || prevNormTitle.includes(currNormTitle));
      const stats = titleSimilarityStats(prev.title, curr.title);
      const sameEnd = (prev.endDate || prev.startDate) === (curr.endDate || curr.startDate);
      const isStrongWordMatch =
        (stats.intersection >= 2 && stats.minOverlapRatio >= 0.5) ||
        (stats.intersection === 1 && stats.maxSize <= 2 && sameEnd);

      if (isSubset || isStrongWordMatch) {
        const score = (isSubset ? 1.0 : 0) + stats.jaccard + stats.minOverlapRatio;
        sameDateCandidates.push({ prevIdx: p, currIdx: c, score });
      }
    }
  }
  sameDateCandidates.sort((a, b) => b.score - a.score);
  for (const cand of sameDateCandidates) {
    if (matchedCurrentIdx.has(cand.currIdx) || matchedActiveIdx.has(cand.prevIdx)) continue;
    matchedCurrentIdx.add(cand.currIdx);
    matchedActiveIdx.add(cand.prevIdx);
    pairs.push({ prevIdx: cand.prevIdx, currIdx: cand.currIdx });
  }

  // Pass 4: Rescheduled event without dedicated URL (different future startDate within 45 days, high title match)
  const rescheduleCandidates = [];
  for (let c = 0; c < upcomingCurrent.length; c++) {
    if (matchedCurrentIdx.has(c)) continue;
    const curr = upcomingCurrent[c];
    if (curr.startDate <= todayStr) continue;
    const currNormTitle = normalizeTitle(curr.title);
    if (currNormTitle.length < 12) continue;

    for (let p = 0; p < activeLedger.length; p++) {
      if (matchedActiveIdx.has(p)) continue;
      const prev = activeLedger[p];
      if (prev.startDate <= todayStr) continue;
      const prevNormTitle = normalizeTitle(prev.title);
      if (prevNormTitle.length < 12) continue;

      const dayDiff = daysBetween(prev.startDate, curr.startDate);
      if (dayDiff === 0 || dayDiff > 45) continue;

      const stats = titleSimilarityStats(prev.title, curr.title);
      if (stats.wordsA.size < 2 || stats.wordsB.size < 2) continue;

      const isMatch = currNormTitle === prevNormTitle || (stats.intersection >= 2 && stats.jaccard >= 0.75);
      if (isMatch) {
        rescheduleCandidates.push({ prevIdx: p, currIdx: c, dayDiff, score: stats.jaccard });
      }
    }
  }
  rescheduleCandidates.sort((a, b) => (b.score - a.score) || (a.dayDiff - b.dayDiff));
  for (const cand of rescheduleCandidates) {
    if (matchedCurrentIdx.has(cand.currIdx) || matchedActiveIdx.has(cand.prevIdx)) continue;
    matchedCurrentIdx.add(cand.currIdx);
    matchedActiveIdx.add(cand.prevIdx);
    pairs.push({ prevIdx: cand.prevIdx, currIdx: cand.currIdx });
  }

  const addedEvents = [];
  const changedEvents = [];
  const cancelledEvents = [];
  const nextClubLedger = [];
  let silentMutation = false;

  // Evaluate matched pairs
  for (const { prevIdx, currIdx } of pairs) {
    const prev = activeLedger[prevIdx];
    const curr = upcomingCurrent[currIdx];
    const changes = classifyEventChange(prev, curr, currentYear);

    const anyFieldDiff =
      prev.startDate !== curr.startDate ||
      (prev.endDate || prev.startDate) !== (curr.endDate || curr.startDate) ||
      prev.displayDate !== curr.displayDate ||
      prev.title !== curr.title ||
      (prev.url || '') !== (curr.url || '') ||
      (prev.difficulty || '') !== (curr.difficulty || '');

    if (changes.isSignificant) {
      changedEvents.push({ previous: prev, current: curr, changes });
      nextClubLedger.push(createLedgerEntry(curr, nowIso, 'active', prev.firstNotifiedAt));
    } else if (anyFieldDiff) {
      silentMutation = true;
      nextClubLedger.push(createLedgerEntry(curr, nowIso, 'active', prev.firstNotifiedAt));
    } else {
      nextClubLedger.push(prev);
    }
  }

  // Unmatched current events -> ADDED (also reactivates any matching previously-cancelled entry)
  const reactivatedCancelledIdx = new Set();
  for (let c = 0; c < upcomingCurrent.length; c++) {
    if (matchedCurrentIdx.has(c)) continue;
    const curr = upcomingCurrent[c];
    const currNormUrl = isDedicatedEventUrl(curr.url) ? normalizeUrl(curr.url) : '';
    const currNormTitle = normalizeTitle(curr.title);

    for (let k = 0; k < cancelledLedger.length; k++) {
      if (reactivatedCancelledIdx.has(k)) continue;
      const oldC = cancelledLedger[k];
      const sameUrl = currNormUrl && isDedicatedEventUrl(oldC.url) && normalizeUrl(oldC.url) === currNormUrl;
      const sameTitleDate = oldC.startDate === curr.startDate && normalizeTitle(oldC.title) === currNormTitle;
      if (sameUrl || sameTitleDate) {
        reactivatedCancelledIdx.add(k);
        break;
      }
    }

    addedEvents.push(curr);
    nextClubLedger.push(createLedgerEntry(curr, nowIso, 'active'));
  }

  // Retain non-reactivated recent cancelled entries so we never re-notify cancellation
  for (let k = 0; k < cancelledLedger.length; k++) {
    if (!reactivatedCancelledIdx.has(k)) {
      nextClubLedger.push(cancelledLedger[k]);
    }
  }

  // Unmatched active ledger entries -> EXPIRED (startDate <= todayStr), duplicate-URL cleanup, or CANCELLED (startDate > todayStr)
  const matchedCurrentDedicatedUrls = new Set(
    upcomingCurrent
      .filter(ev => isDedicatedEventUrl(ev.url))
      .map(ev => normalizeUrl(ev.url))
  );
  const candidateCancellations = [];
  const activeUpcomingLedgerCount = activeLedger.filter(ev => ev.startDate > todayStr).length;

  for (let p = 0; p < activeLedger.length; p++) {
    if (matchedActiveIdx.has(p)) continue;
    const prev = activeLedger[p];

    // If startDate is today or in the past, the hike already started/completed — never a cancellation
    if (prev.startDate <= todayStr) {
      silentMutation = true;
      // Prune entries past retention window; otherwise silently expire them
      if ((prev.endDate || prev.startDate) >= cutoffDate) {
        nextClubLedger.push({ ...prev, status: 'expired', lastUpdatedAt: nowIso });
      }
      continue;
    }

    // If the same dedicated event URL is still active in currentEvents (from an older duplicate entry),
    // silently drop the stale duplicate rather than falsely announcing a cancellation.
    if (isDedicatedEventUrl(prev.url) && matchedCurrentDedicatedUrls.has(normalizeUrl(prev.url))) {
      silentMutation = true;
      continue;
    }

    candidateCancellations.push(prev);
  }

  let suppressedMassCancellation = null;
  const isMassCancellation =
    !allowMassCancel &&
    candidateCancellations.length >= 3 &&
    activeUpcomingLedgerCount > 0 &&
    (candidateCancellations.length / activeUpcomingLedgerCount) >= 0.30;

  if (candidateCancellations.length > 0) {
    if (suppressCancellations || isMassCancellation) {
      // Hold frozen in ledger as active so we never spam false cancellations
      for (const prev of candidateCancellations) {
        nextClubLedger.push(prev);
      }
      if (isMassCancellation) {
        suppressedMassCancellation = {
          club,
          count: candidateCancellations.length,
          totalActive: activeUpcomingLedgerCount
        };
      }
    } else {
      for (const prev of candidateCancellations) {
        cancelledEvents.push(prev);
        nextClubLedger.push({ ...prev, status: 'cancelled', lastUpdatedAt: nowIso });
      }
    }
  }

  // Silently expire already-completed active ledger events (endDate < todayStr)
  for (const past of pastActiveLedger) {
    silentMutation = true;
    if ((past.endDate || past.startDate) >= cutoffDate) {
      nextClubLedger.push({ ...past, status: 'expired', lastUpdatedAt: nowIso });
    }
  }

  // Keep non-expired expired-status entries only within retention window
  const recentExpired = ledgerEntries.filter(
    ev => ev.status === 'expired' && (ev.endDate || ev.startDate) >= cutoffDate
  );
  for (const exp of recentExpired) {
    nextClubLedger.push(exp);
  }
  if (ledgerEntries.some(ev => (ev.status === 'expired' || ev.status === 'cancelled') && (ev.endDate || ev.startDate) < cutoffDate)) {
    silentMutation = true;
  }

  return {
    addedEvents,
    changedEvents,
    cancelledEvents,
    nextClubLedger,
    silentMutation,
    suppressedMassCancellation
  };
}

/**
 * Full diff across all clubs comparing current events.json against persistent
 * notified-events.json ledger, respecting per-club health so healthy clubs
 * ALWAYS notify even while other clubs are in fallback.
 */
export function diffEventsWithLedger({
  currentEvents = [],
  ledger = null,
  statusData = { logs: [] },
  clubHealth = null,
  todayStr = getAthensToday(),
  nowIso = new Date().toISOString(),
  allowMassCancel = false
}) {
  const statusLogs = statusData?.logs || [];

  // Bootstrap ledger silently if missing (first initialization)
  if (!ledger || !Array.isArray(ledger.events)) {
    const seededEntries = sortLedgerEntries(
      currentEvents
        .filter(ev => ev && ev.club && ev.startDate && (ev.endDate || ev.startDate) >= todayStr)
        .map(ev => createLedgerEntry(ev, nowIso, 'active'))
    );
    return {
      bootstrapped: true,
      clubs: [],
      addedEvents: [],
      changedEvents: [],
      cancelledEvents: [],
      suppressedMassCancellations: [],
      healthyClubsCount: statusLogs.filter(l => l.status === 'success').length,
      totalClubsCount: Math.max(statusLogs.length, 8),
      statusLogs,
      nextLedger: { version: 1, updatedAt: nowIso, events: seededEntries },
      hasSilentLedgerChanges: true
    };
  }

  // Determine per-club eligibility
  const healthMatchesStatus = Boolean(
    clubHealth &&
    clubHealth.clubs &&
    (!statusData?.lastUpdated || !clubHealth.lastProcessedStatusTimestamp || clubHealth.lastProcessedStatusTimestamp === statusData.lastUpdated)
  );
  // Honor explicit `npm run baseline:accept` for this scrape run so verified mass cancellations are not deadlocked
  const baselineAcceptedForCurrentStatus = Boolean(
    healthMatchesStatus &&
    statusData?.lastUpdated &&
    clubHealth?.baselineAcceptedForTimestamp === statusData.lastUpdated
  );

  const healthyClubs = new Set();
  const cancelSuppressedClubs = new Set();
  const degradedClubSet = new Set();

  for (const log of statusLogs) {
    if (!log.club) continue;
    const ch = healthMatchesStatus ? clubHealth.clubs[log.club] : null;
    if (log.status === 'success') {
      if (ch && (ch.status === 'parser_error' || ch.status === 'data_loss')) {
        degradedClubSet.add(log.club);
      } else if (ch && ch.status === 'event_drop') {
        healthyClubs.add(log.club);
        cancelSuppressedClubs.add(log.club);
      } else {
        healthyClubs.add(log.club);
      }
    } else {
      degradedClubSet.add(log.club);
    }
  }

  // Group current events and ledger entries by club
  const currentByClub = new Map();
  for (const ev of currentEvents) {
    if (!ev || !ev.club) continue;
    if (!currentByClub.has(ev.club)) currentByClub.set(ev.club, []);
    currentByClub.get(ev.club).push(ev);
  }

  const ledgerByClub = new Map();
  for (const entry of ledger.events) {
    if (!entry || !entry.club) continue;
    if (!ledgerByClub.has(entry.club)) ledgerByClub.set(entry.club, []);
    ledgerByClub.get(entry.club).push(entry);
  }

  const allClubs = new Set([
    ...statusLogs.map(l => l.club).filter(Boolean),
    ...currentByClub.keys(),
    ...ledgerByClub.keys()
  ]);

  const addedEvents = [];
  const changedEvents = [];
  const cancelledEvents = [];
  const suppressedMassCancellations = [];
  const nextAllLedgerEntries = [];
  let hasSilentLedgerChanges = false;

  for (const club of allClubs) {
    const clubLedger = ledgerByClub.get(club) || [];

    if (!healthyClubs.has(club)) {
      // Club is in fallback/error: preserve its ledger entries completely untouched
      nextAllLedgerEntries.push(...clubLedger);
      continue;
    }

    const res = diffClubEvents({
      club,
      currentEvents: currentByClub.get(club) || [],
      ledgerEntries: clubLedger,
      todayStr,
      nowIso,
      suppressCancellations: cancelSuppressedClubs.has(club),
      allowMassCancel: allowMassCancel || baselineAcceptedForCurrentStatus
    });

    addedEvents.push(...res.addedEvents);
    changedEvents.push(...res.changedEvents);
    cancelledEvents.push(...res.cancelledEvents);
    nextAllLedgerEntries.push(...res.nextClubLedger);
    if (res.silentMutation) hasSilentLedgerChanges = true;
    if (res.suppressedMassCancellation) {
      suppressedMassCancellations.push(res.suppressedMassCancellation);
    }
  }

  // Sort results chronologically for clean messages
  const byStartDate = (a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''));
  addedEvents.sort(byStartDate);
  changedEvents.sort((a, b) => byStartDate(a.current, b.current));
  cancelledEvents.sort(byStartDate);

  const affectedClubs = [...new Set([
    ...addedEvents.map(e => e.club),
    ...changedEvents.map(c => c.current.club),
    ...cancelledEvents.map(e => e.club)
  ])];

  const healthyStrictCount = statusLogs.filter(l => {
    if (l.status !== 'success') return false;
    const ch = healthMatchesStatus ? clubHealth.clubs[l.club] : null;
    return !ch || ch.status === 'healthy';
  }).length;

  return {
    bootstrapped: false,
    clubs: affectedClubs,
    addedEvents,
    changedEvents,
    cancelledEvents,
    suppressedMassCancellations,
    healthyClubsCount: healthyStrictCount,
    totalClubsCount: Math.max(statusLogs.length, 8),
    statusLogs,
    nextLedger: {
      version: 1,
      updatedAt: nowIso,
      events: sortLedgerEntries(nextAllLedgerEntries)
    },
    hasSilentLedgerChanges
  };
}

function formatChangeDetailsGreek(changes) {
  const parts = [];
  if (changes.dateChanged) {
    parts.push(`ημερομηνία (από ${changes.oldDateStr})`);
  }
  if (changes.difficultyChanged) {
    parts.push(`Β.Δ. (από ${changes.oldDifficulty})`);
  }
  if (changes.titleChanged) {
    parts.push('διαδρομή/πρόγραμμα');
  }
  if (parts.length === 0) return 'Ενημέρωση στοιχείων';
  return `Αλλαγή σε ${parts.join(', ')}`;
}

/**
 * Builds Telegram HTML (safely chunked <= 3900 chars) and Buttondown Email Markdown
 * for subscribers covering added, changed, and cancelled excursions.
 */
export function buildSubscriberMessages({
  clubs = [],
  addedEvents = [],
  changedEvents = [],
  cancelledEvents = [],
  currentYear = getAthensToday().slice(0, 4)
}) {
  const isSingleClub = clubs.length === 1;
  const clubsText = clubs.join(', ');
  const hasAdded = addedEvents.length > 0;
  const hasChanged = changedEvents.length > 0;
  const hasCancelled = cancelledEvents.length > 0;
  const sectionCount = [hasAdded, hasChanged, hasCancelled].filter(Boolean).length;

  const clubPhraseTg = isSingleClub
    ? `από τον σύλλογο <b>${escapeHtml(clubsText)}</b>`
    : `από τους συλλόγους <b>${escapeHtml(clubsText)}</b>`;
  const clubPhraseEmail = isSingleClub
    ? `από τον σύλλογο **${clubsText}**`
    : `από τους συλλόγους **${clubsText}**`;

  let headerTg = '';
  let headerEmail = '';
  let emailSubject = '';

  if (sectionCount > 1) {
    headerTg = `Ενημερώσεις εξορμήσεων ${clubPhraseTg}:`;
    headerEmail = `Ενημερώσεις εξορμήσεων ${clubPhraseEmail}:`;
    emailSubject = `Ενημερώσεις εξορμήσεων: ${clubsText} — Ορειβατικό Ημερολόγιο`;
  } else if (hasAdded) {
    const singular = addedEvents.length === 1;
    headerTg = singular
      ? `Προστέθηκε νέα εξόρμηση ${clubPhraseTg}:`
      : `Προστέθηκαν νέες εξορμήσεις ${clubPhraseTg}:`;
    headerEmail = singular
      ? `Προστέθηκε νέα εξόρμηση ${clubPhraseEmail}:`
      : `Προστέθηκαν νέες εξορμήσεις ${clubPhraseEmail}:`;
    emailSubject = singular
      ? `Νέα εξόρμηση: ${clubsText} — Ορειβατικό Ημερολόγιο`
      : `Νέες εξορμήσεις: ${clubsText} — Ορειβατικό Ημερολόγιο`;
  } else if (hasChanged) {
    const singular = changedEvents.length === 1;
    headerTg = singular
      ? `Ενημερώθηκε εξόρμηση ${clubPhraseTg}:`
      : `Ενημερώθηκαν εξορμήσεις ${clubPhraseTg}:`;
    headerEmail = singular
      ? `Ενημερώθηκε εξόρμηση ${clubPhraseEmail}:`
      : `Ενημερώθηκαν εξορμήσεις ${clubPhraseEmail}:`;
    emailSubject = singular
      ? `Αλλαγή εξόρμησης: ${clubsText} — Ορειβατικό Ημερολόγιο`
      : `Αλλαγές εξορμήσεων: ${clubsText} — Ορειβατικό Ημερολόγιο`;
  } else {
    const singular = cancelledEvents.length === 1;
    headerTg = singular
      ? `Ακυρώθηκε εξόρμηση ${clubPhraseTg}:`
      : `Ακυρώθηκαν εξορμήσεις ${clubPhraseTg}:`;
    headerEmail = singular
      ? `Ακυρώθηκε εξόρμηση ${clubPhraseEmail}:`
      : `Ακυρώθηκαν εξορμήσεις ${clubPhraseEmail}:`;
    emailSubject = singular
      ? `Ακύρωση εξόρμησης: ${clubsText} — Ορειβατικό Ημερολόγιο`
      : `Ακυρώσεις εξορμήσεων: ${clubsText} — Ορειβατικό Ημερολόγιο`;
  }

  const tgBlocks = [];
  const emailBlocks = [];

  // Bind each section header directly to its first item so multi-chunk splitting
  // can NEVER leave a dangling section header orphaned at the bottom of a chunk.
  const pushSectionItems = (tgHeader, emailHeader, tgItems, emailItems) => {
    if (tgItems.length === 0) return;
    if (sectionCount > 1) {
      const sep = tgBlocks.length > 0 ? '\n' : '';
      tgBlocks.push(`${sep}${tgHeader}\n${tgItems[0]}`);
      for (let i = 1; i < tgItems.length; i++) tgBlocks.push(tgItems[i]);

      if (emailBlocks.length > 0) emailBlocks.push('');
      emailBlocks.push(emailHeader);
      emailBlocks.push(...emailItems);
    } else {
      tgBlocks.push(...tgItems);
      emailBlocks.push(...emailItems);
    }
  };

  if (hasAdded) {
    const tgItems = [];
    const emItems = [];
    for (const ev of addedEvents) {
      const dateStr = formatEventDate(ev, currentYear);
      const diffTag = ev.difficulty ? ` (Β.Δ. ${ev.difficulty})` : '';
      const eventUrl = `${SITE_URL}#${getEventAnchor(ev)}`;

      const tgPrefix = isSingleClub
        ? `• <b>${escapeHtml(dateStr)}</b>: `
        : `• <b>[${escapeHtml(ev.club)}] ${escapeHtml(dateStr)}</b>: `;
      tgItems.push(`${tgPrefix}<a href="${escapeHtml(eventUrl)}">${escapeHtml(ev.title)}</a>${escapeHtml(diffTag)}`);

      const emPrefix = isSingleClub
        ? `* **${dateStr}**: `
        : `* **[${ev.club}] ${dateStr}**: `;
      emItems.push(`${emPrefix}[${escapeMarkdownLinkText(ev.title)}](${eventUrl})${diffTag}`);
    }
    pushSectionItems('<b>➕ Νέες εξορμήσεις</b>', '### ➕ Νέες εξορμήσεις', tgItems, emItems);
  }

  if (hasChanged) {
    const tgItems = [];
    const emItems = [];
    for (const item of changedEvents) {
      const ev = item.current;
      const dateStr = formatEventDate(ev, currentYear);
      const diffTag = ev.difficulty ? ` (Β.Δ. ${ev.difficulty})` : '';
      const eventUrl = `${SITE_URL}#${getEventAnchor(ev)}`;
      const changeNote = formatChangeDetailsGreek(item.changes);

      const tgPrefix = isSingleClub
        ? `• <b>${escapeHtml(dateStr)}</b>: `
        : `• <b>[${escapeHtml(ev.club)}] ${escapeHtml(dateStr)}</b>: `;
      tgItems.push(
        `${tgPrefix}<a href="${escapeHtml(eventUrl)}">${escapeHtml(ev.title)}</a>${escapeHtml(diffTag)}\n  <i>↳ ${escapeHtml(changeNote)}</i>`
      );

      const emPrefix = isSingleClub
        ? `* **${dateStr}**: `
        : `* **[${ev.club}] ${dateStr}**: `;
      emItems.push(`${emPrefix}[${escapeMarkdownLinkText(ev.title)}](${eventUrl})${diffTag}  \n  *↳ ${changeNote}*`);
    }
    pushSectionItems('<b>🔄 Αλλαγές σε εξορμήσεις</b>', '### 🔄 Αλλαγές σε εξορμήσεις', tgItems, emItems);
  }

  if (hasCancelled) {
    const tgItems = [];
    const emItems = [];
    for (const ev of cancelledEvents) {
      const dateStr = formatEventDate(ev, currentYear);
      const diffTag = ev.difficulty ? ` (Β.Δ. ${ev.difficulty})` : '';

      // No #ev-... anchor for cancelled events because they are no longer on the site
      const tgPrefix = isSingleClub
        ? `• <b>${escapeHtml(dateStr)}</b>: `
        : `• <b>[${escapeHtml(ev.club)}] ${escapeHtml(dateStr)}</b>: `;
      tgItems.push(`${tgPrefix}${escapeHtml(ev.title)}${escapeHtml(diffTag)}`);

      const emPrefix = isSingleClub
        ? `* **${dateStr}**: `
        : `* **[${ev.club}] ${dateStr}**: `;
      emItems.push(`${emPrefix}${ev.title}${diffTag}`);
    }
    pushSectionItems('<b>❌ Ακυρώσεις εξορμήσεων</b>', '### ❌ Ακυρώσεις εξορμήσεων', tgItems, emItems);
  }

  const footerTg = `Δείτε το ανανεωμένο πρόγραμμα στο <a href="${SITE_URL}">Ορειβατικό Ημερολόγιο</a>.`;
  const footerEmail = `Δείτε το ανανεωμένο πρόγραμμα στο [Ορειβατικό Ημερολόγιο](${SITE_URL}).`;

  const telegramMessages = chunkTelegramBlocks(headerTg, tgBlocks, footerTg, 3900);
  const fullEmailBody = `${headerEmail}\n\n${emailBlocks.join('\n')}\n\n${footerEmail}`;

  return {
    telegramMessages,
    emailSubject,
    emailBody: fullEmailBody
  };
}

/**
 * Builds plain-language Greek Admin Telegram alerts explaining exactly what happened,
 * whether users/subscribers were impacted, and the single best option to take.
 */
export function buildAdminHealthAlert({
  clubHealth = null,
  statusData = null,
  statusLogs = [],
  suppressedMassCancellations = [],
  subscriberSummary = null,
  runUrl = '',
  issueUrl = '',
  issueAction = 'none',
  healthyClubsCount = 8,
  totalClubsCount = 8,
  broadcastErrors = [],
  isScrapeRun = true,
  isSelfHealPush = false,
  isTestAlert = false
}) {
  const effectiveLogs = statusLogs.length > 0 ? statusLogs : (statusData?.logs || []);
  const healthMatchesStatus = Boolean(
    clubHealth &&
    clubHealth.clubs &&
    (!statusData?.lastUpdated || !clubHealth.lastProcessedStatusTimestamp || clubHealth.lastProcessedStatusTimestamp === statusData.lastUpdated)
  );

  // Include scraper health details on actual scrape runs and local self-heal pushes (not on unrelated code pushes)
  const checkClubHealth = isScrapeRun || isSelfHealPush;
  const clubEntries = (checkClubHealth && healthMatchesStatus) ? Object.entries(clubHealth.clubs) : [];

  const transientClubs = clubEntries.filter(([, c]) => c.status === 'transient_fallback');
  const criticalFallbackClubs = clubEntries.filter(([, c]) => c.status === 'critical_fallback');
  const parserErrorClubs = clubEntries.filter(([, c]) => c.status === 'parser_error' || c.status === 'data_loss');
  const eventDropClubs = clubEntries.filter(([, c]) => c.status === 'event_drop');

  // Fallback to raw statusLogs only on scrape/self-heal runs when clubHealth is absent or stale
  const rawDegradedLogs = (checkClubHealth && clubEntries.length === 0)
    ? effectiveLogs.filter(l => l.status === 'warning' || l.status === 'error')
    : [];

  const hasIssues =
    transientClubs.length > 0 ||
    criticalFallbackClubs.length > 0 ||
    parserErrorClubs.length > 0 ||
    eventDropClubs.length > 0 ||
    rawDegradedLogs.length > 0 ||
    suppressedMassCancellations.length > 0 ||
    broadcastErrors.length > 0;

  const isRecovery = !hasIssues && isScrapeRun && !isTestAlert && issueAction === 'closed';
  const isSelfHealConfirmation = !hasIssues && isSelfHealPush && !isTestAlert;
  const isTestAlertNotification = !hasIssues && (Boolean(isTestAlert) || (isScrapeRun && (issueAction === 'created' || issueAction === 'commented')));
  if (!hasIssues && !isRecovery && !isSelfHealConfirmation && !isTestAlertNotification) {
    return null;
  }

  // Keep test-alert issue links strictly isolated to test-alert notifications
  // so a real club-health/delivery alert during a test_alert run never links to a test-alert issue.
  const effectiveIssueUrl = (isTestAlert && !isTestAlertNotification) ? '' : issueUrl;

  const links = [];
  if (effectiveIssueUrl) {
    const issueNumMatch = effectiveIssueUrl.match(/\/issues\/(\d+)/);
    const label = issueNumMatch ? `GitHub Issue #${issueNumMatch[1]}` : 'GitHub Issue';
    links.push(`<a href="${escapeHtml(effectiveIssueUrl)}">${escapeHtml(label)}</a>`);
  }
  if (runUrl) {
    links.push(`<a href="${escapeHtml(runUrl)}">GitHub Actions Run</a>`);
  }
  const linksLine = links.length > 0 ? `\n\n🔗 ${links.join(' · ')}` : '';

  if (isTestAlertNotification) {
    const msg = [
      `🧪 <b>Mount Athens — Δοκιμαστική Ειδοποίηση (Test Alert)</b>`,
      '',
      `Το pipeline ελέγχου ανωμαλιών, GitHub Issues και ειδοποίησης διαχειριστή λειτουργεί κανονικά. Όλοι οι <b>${healthyClubsCount}/${totalClubsCount}</b> σύλλογοι είναι υγιείς.`,
      '',
      `<b>Τι προτείνεται να κάνεις:</b>`,
      `Κλείσε το δοκιμαστικό GitHub Issue όποτε θέλεις.${linksLine}`
    ].join('\n');
    return chunkHtmlText(msg, 3900);
  }

  if (isRecovery) {
    const msg = [
      `✅ <b>Mount Athens — Αυτόματη Επαναφορά</b>`,
      '',
      `Όλοι οι <b>${healthyClubsCount}/${totalClubsCount}</b> σύλλογοι λειτουργούν ξανά κανονικά (0 σφάλματα, 0 fallbacks). Το ανοιχτό GitHub Issue έκλεισε αυτόματα.`,
      '',
      `<b>Τι προτείνεται να κάνεις:</b>`,
      `Καμία ενέργεια — όλα είναι εντάξει.${linksLine}`
    ].join('\n');
    return chunkHtmlText(msg, 3900);
  }

  if (isSelfHealConfirmation) {
    const clubsStatusText = healthyClubsCount >= totalClubsCount
      ? `Όλοι οι <b>${healthyClubsCount}/${totalClubsCount}</b> σύλλογοι είναι υγιείς (0 σφάλματα, 0 fallbacks).`
      : `Υγιείς σύλλογοι: <b>${healthyClubsCount}/${totalClubsCount}</b>.`;
    const subscriberLine = subscriberSummary
      ? `<i>Ειδοποιήσεις συνδρομητών: ${escapeHtml(subscriberSummary)}</i>`
      : `<i>Ειδοποιήσεις συνδρομητών: Δεν υπήρχαν νέες αλλαγές προς αποστολή.</i>`;
    const msg = [
      `🛠️ <b>Mount Athens — Τοπική Επιδιόρθωση (Self-Heal) Ολοκληρώθηκε</b>`,
      '',
      `Το local self-heal ενημέρωσε επιτυχώς τα δεδομένα και το site έγινε deploy κανονικά. ${clubsStatusText}`,
      subscriberLine,
      '',
      `<b>Τι προτείνεται να κάνεις:</b>`,
      `Καμία ενέργεια — όλα είναι εντάξει.${linksLine}`
    ].join('\n');
    return chunkHtmlText(msg, 3900);
  }

  let title = '';
  const hasRealParserOrDrop = parserErrorClubs.length > 0 || eventDropClubs.length > 0 || suppressedMassCancellations.length > 0;
  const hasCriticalBlock = criticalFallbackClubs.length > 0;
  const hasOnlyBroadcastErrors =
    broadcastErrors.length > 0 &&
    !hasRealParserOrDrop &&
    !hasCriticalBlock &&
    transientClubs.length === 0 &&
    rawDegradedLogs.length === 0;

  if (hasOnlyBroadcastErrors) {
    title = `🔴 <b>Mount Athens — Σφάλμα Αποστολής Ειδοποιήσεων</b>`;
  } else if (hasRealParserOrDrop) {
    title = `🔴 <b>Mount Athens — Πρόβλημα Ανάγνωσης Σελίδας (Parser / Αλλαγή Site)</b>`;
  } else if (hasCriticalBlock) {
    title = `🟠 <b>Mount Athens — Επίμονο Μπλοκάρισμα IP (2+ runs)</b>`;
  } else {
    title = `🟡 <b>Mount Athens — Προσωρινό Μπλοκάρισμα (1η φορά)</b>`;
  }

  const whatHappenedLines = [];
  for (const [club, info] of parserErrorClubs) {
    const cacheNote = info.preservedCount > 0
      ? `διατηρήθηκαν ${info.preservedCount} αποθηκευμένες εξορμήσεις (fallback)`
      : `χωρίς διαθέσιμο cache`;
    whatHappenedLines.push(`• <b>${escapeHtml(club)}</b>: ${escapeHtml(info.lastError || 'Σφάλμα parser')} — ${escapeHtml(cacheNote)}.`);
  }
  for (const [club, info] of eventDropClubs) {
    whatHappenedLines.push(`• <b>${escapeHtml(club)}</b>: ${escapeHtml(info.lastError || 'Απότομη πτώση εξορμήσεων')} (κρατήθηκε το baseline, δεν στάλθηκαν ακυρώσεις).`);
  }
  for (const [club, info] of criticalFallbackClubs) {
    whatHappenedLines.push(
      `• <b>${escapeHtml(club)}</b>: ${info.consecutiveFetchFallbacks} συνεχόμενες αποτυχίες (${escapeHtml(info.lastError || 'Cloudflare / HTTP error')}) — σε fallback (${info.preservedCount} εξορμήσεις).`
    );
  }
  for (const [club, info] of transientClubs) {
    whatHappenedLines.push(
      `• <b>${escapeHtml(club)}</b>: Προσωρινό μπλοκάρισμα 1ης φοράς (${escapeHtml(info.lastError || 'Cloudflare / HTTP error')}) — σε fallback (${info.preservedCount} εξορμήσεις).`
    );
  }
  for (const log of rawDegradedLogs) {
    whatHappenedLines.push(`• <b>${escapeHtml(log.club)}</b>: ${escapeHtml(log.details || 'Προειδοποίηση scraper')}.`);
  }
  for (const mc of suppressedMassCancellations) {
    whatHappenedLines.push(
      `• <b>${escapeHtml(mc.club)}</b>: Εντοπίστηκαν ${mc.count}/${mc.totalActive} πιθανές ακυρώσεις — κρατήθηκαν σε αναμονή για επιβεβαίωση ώστε να μην σταλεί εσφαλμένο μήνυμα.`
    );
  }
  for (const err of broadcastErrors) {
    whatHappenedLines.push(`• <b>Αποστολή (${escapeHtml(err.channel)})</b>: ${escapeHtml(err.message)}`);
  }

  const subscriberLine = subscriberSummary
    ? `<i>Ειδοποιήσεις συνδρομητών: ${escapeHtml(subscriberSummary)}</i>`
    : `<i>Ειδοποιήσεις συνδρομητών: Δεν υπήρχαν νέες αλλαγές από τους υγιείς συλλόγους.</i>`;

  const noCacheClubs = [...parserErrorClubs, ...criticalFallbackClubs]
    .filter(([, info]) => !info.preservedCount || info.preservedCount === 0)
    .map(([club]) => club);

  let impactMainLine = `Οι χρήστες ΔΕΝ βλέπουν τεχνικά σφάλματα — το site δείχνει κανονικά τις αποθηκευμένες εξορμήσεις (fallback). Οι υγιείς σύλλογοι (${healthyClubsCount}/${totalClubsCount}) λειτουργούν κανονικά.`;
  if (hasOnlyBroadcastErrors) {
    impactMainLine = `Το site ενημερώθηκε κανονικά (${healthyClubsCount}/${totalClubsCount} σύλλογοι OK), αλλά υπήρξε σφάλμα σε κανάλι αποστολής ειδοποιήσεων.`;
  } else if (noCacheClubs.length > 0) {
    impactMainLine = `Οι χρήστες ΔΕΝ βλέπουν τεχνικά σφάλματα, αλλά για <b>${escapeHtml(noCacheClubs.join(', '))}</b> δεν υπήρχε διαθέσιμο cache (προσωρινά δεν εμφανίζονται εξορμήσεις του στο site). Οι υγιείς σύλλογοι (${healthyClubsCount}/${totalClubsCount}) λειτουργούν κανονικά.`;
  }

  const impactLines = [
    `<b>Επίδραση στους χρήστες:</b>`,
    impactMainLine,
    subscriberLine
  ];

  const guidanceLines = [`<b>Τι προτείνεται να κάνεις:</b>`];
  if (broadcastErrors.length > 0) {
    guidanceLines.push(`• Έλεγξε το API token/κλειδί για το κανάλι που απέτυχε στο GitHub Actions Run. Αν απέτυχαν όλα τα κανάλια, οι εκκρεμείς ειδοποιήσεις θα ξανασταλούν αυτόματα στο επόμενο run.`);
  }
  if (parserErrorClubs.length > 0) {
    guidanceLines.push(`• <b>Καλύτερη επιλογή (Parser/Site):</b> Άνοιξε το GitHub Issue και στείλε το έτοιμο prompt στον Antigravity Remote Agent για να διορθώσει τον parser ή το URL.`);
  }
  if (eventDropClubs.length > 0 || suppressedMassCancellations.length > 0) {
    guidanceLines.push(`• <b>Για πτώση εξορμήσεων:</b> Έλεγξε τη σελίδα του συλλόγου. Αν όντως ακυρώθηκαν εξορμήσεις, τρέξε <code>npm run baseline:accept</code> και κάνε push (έπειτα θα σταλούν κανονικά οι ειδοποιήσεις ακύρωσης).`);
  }
  if (criticalFallbackClubs.length > 0) {
    guidanceLines.push(`• <b>Καλύτερη επιλογή (IP block 2+ runs):</b> Άφησε το local self-heal στο Mac σου να το λύσει αυτόματα από οικιακή IP. Αν το Mac είναι κλειστό, τρέξε <code>npm run scrape</code> όταν επιστρέψεις.`);
  }
  if (transientClubs.length > 0 && !hasRealParserOrDrop && !hasCriticalBlock && broadcastErrors.length === 0) {
    guidanceLines.push(`• <b>Καμία ενέργεια τώρα.</b> Είναι η 1η φορά (πιθανό προσωρινό μπλοκάρισμα IP του GitHub) και δεν άνοιξε GitHub Issue. Αν συνεχιστεί και στο επόμενο run, θα ανοίξει Issue και θα τρέξει αυτόματα το local self-heal.`);
  }
  if (rawDegradedLogs.length > 0 && guidanceLines.length === 1) {
    guidanceLines.push(`• Άνοιξε το GitHub Actions Run για να δεις τις λεπτομέρειες του scraper. Αν είναι προσωρινό μπλοκάρισμα, περίμενε το επόμενο run ή τρέξε <code>npm run scrape</code> τοπικά.`);
  }

  const fullAlert = [
    title,
    '',
    `<b>Τι συνέβη:</b>`,
    whatHappenedLines.join('\n'),
    '',
    impactLines.join('\n'),
    '',
    guidanceLines.join('\n') + linksLine
  ].join('\n');

  return chunkHtmlText(fullAlert, 3900);
}

/**
 * Generates GitHub Actions Step Summary and local summary markdown file.
 */
function recordAdminChangeLog({
  addedEvents,
  changedEvents,
  cancelledEvents,
  healthyClubsCount,
  totalClubsCount,
  statusLogs,
  todayStr,
  localSummaryFile = DEFAULT_PATHS.localSummaryFile
}) {
  const currentYear = todayStr.slice(0, 4);
  const lines = [];
  lines.push(`### 🏔️ Mount Athens — Excursion Sync Summary`);
  lines.push(`**Date:** ${todayStr} | **Healthy Clubs:** ${healthyClubsCount}/${totalClubsCount}\n`);

  if (addedEvents.length === 0 && changedEvents.length === 0 && cancelledEvents.length === 0) {
    lines.push(`*No excursions were added, changed, or cancelled across healthy clubs in this run.*\n`);
  }

  if (addedEvents.length > 0) {
    lines.push(`#### ➕ Newly Added Excursions (${addedEvents.length})`);
    lines.push(`| Date | Club | Title | Difficulty | Site Link | Club Booking |`);
    lines.push(`| :--- | :--- | :--- | :---: | :--- | :--- |`);
    for (const ev of addedEvents) {
      const dateStr = formatEventDate(ev, currentYear);
      const diff = ev.difficulty || '-';
      const siteLink = `[Site Anchor](${SITE_URL}#${getEventAnchor(ev)})`;
      const clubLink = ev.url ? `[Club Booking](${ev.url})` : '-';
      lines.push(`| ${dateStr} | ${ev.club} | ${ev.title} | ${diff} | ${siteLink} | ${clubLink} |`);
    }
    lines.push('');
  }

  if (changedEvents.length > 0) {
    lines.push(`#### 🔄 Updated Excursions (${changedEvents.length})`);
    lines.push(`| Date | Club | Title | Changes | Site Link |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const item of changedEvents) {
      const ev = item.current;
      const dateStr = formatEventDate(ev, currentYear);
      const changeNote = formatChangeDetailsGreek(item.changes);
      const siteLink = `[Site Anchor](${SITE_URL}#${getEventAnchor(ev)})`;
      lines.push(`| ${dateStr} | ${ev.club} | ${ev.title} | ${changeNote} | ${siteLink} |`);
    }
    lines.push('');
  }

  if (cancelledEvents.length > 0) {
    lines.push(`#### ❌ Cancelled / Removed Excursions (${cancelledEvents.length})`);
    lines.push(`| Date | Club | Title | Difficulty |`);
    lines.push(`| :--- | :--- | :--- | :---: |`);
    for (const ev of cancelledEvents) {
      const dateStr = formatEventDate(ev, currentYear);
      const diff = ev.difficulty || '-';
      lines.push(`| ${dateStr} | ${ev.club} | ${ev.title} | ${diff} |`);
    }
    lines.push('');
  }

  if (statusLogs.length > 0) {
    lines.push(`#### 📊 Club Scraper Status`);
    lines.push(`| Club | Status | Details |`);
    lines.push(`| :--- | :---: | :--- |`);
    for (const log of statusLogs) {
      const statusIcon = log.status === 'success' ? '✅ OK' : '⚠️ Degraded';
      lines.push(`| ${log.club} | ${statusIcon} | ${log.details || '-'} |`);
    }
    lines.push('');
  }

  const markdownContent = lines.join('\n');

  const summaryEnv = process.env.GITHUB_STEP_SUMMARY;
  if (summaryEnv) {
    try {
      fs.appendFileSync(summaryEnv, markdownContent + '\n', 'utf-8');
      console.log('[notifications] Appended change log to $GITHUB_STEP_SUMMARY.');
    } catch (err) {
      console.warn('[notifications] Failed to write to GITHUB_STEP_SUMMARY:', err.message);
    }
  }

  try {
    const inputDir = path.dirname(localSummaryFile);
    if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(localSummaryFile, markdownContent, 'utf-8');
  } catch {
    // Ignore non-critical local file write errors
  }
}

async function sendTelegramMessage(botToken, chatId, htmlText, fetchImpl = fetch) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram API error (${res.status}) for chat ${chatId}: ${errText}`);
  }
}

async function sendButtondownEmail(apiKey, subject, body, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.buttondown.com/v1/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Buttondown-Live-Dangerously': 'true'
    },
    body: JSON.stringify({
      subject,
      body,
      status: 'about_to_send'
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Buttondown API error (${res.status}): ${errText}`);
  }
}

function summarizeCountsGreek(added, changed, cancelled, clubs) {
  const parts = [];
  if (added > 0) parts.push(`+${added} νέες`);
  if (changed > 0) parts.push(`~${changed} αλλαγές`);
  if (cancelled > 0) parts.push(`-${cancelled} ακυρώσεις`);
  if (parts.length === 0) return null;
  return `${parts.join(', ')} (${clubs.join(', ')})`;
}

export async function runNotifications(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const args = options.argv || process.argv.slice(2);

  const isDryRun = args.includes('--dry-run');
  const isTestAdmin = args.includes('--test-admin');
  const isInitLedger = args.includes('--init-ledger');
  const allowMassCancel = args.includes('--allow-mass-cancel');
  const simArg = args.find(a => a.startsWith('--simulate='));

  const todayStr = options.todayStr || getAthensToday();
  const currentYear = todayStr.slice(0, 4);
  const nowIso = options.nowIso || new Date().toISOString();

  // Env flags passed by CI workflow
  const isScrapeRun = env.IS_SCRAPE_RUN !== 'false';
  const isSelfHealPush = env.IS_SELF_HEAL_PUSH === 'true';
  const isTestAlert = env.IS_TEST_ALERT === 'true';
  const runUrl = env.GITHUB_RUN_URL || '';
  const issueUrl = env.ANOMALY_ISSUE_URL || '';
  const issueAction = env.ANOMALY_ISSUE_ACTION || 'none';

  const currentEvents = loadJsonSafe(paths.eventsFile, []);
  const statusData = loadJsonSafe(paths.statusFile, { logs: [] });
  const clubHealth = loadJsonSafe(paths.clubHealthFile, null);

  if (isInitLedger) {
    const seededEntries = sortLedgerEntries(
      currentEvents
        .filter(ev => ev && ev.club && ev.startDate && (ev.endDate || ev.startDate) >= todayStr)
        .map(ev => createLedgerEntry(ev, nowIso, 'active'))
    );
    const ledgerObj = { version: 1, updatedAt: nowIso, events: seededEntries };
    fs.writeFileSync(paths.ledgerFile, JSON.stringify(ledgerObj, null, 2), 'utf-8');
    console.log(`[notifications] Initialized ${paths.ledgerFile} with ${seededEntries.length} upcoming events.`);
    return { initialized: true, eventCount: seededEntries.length };
  }

  let clubs = [];
  let addedEvents = [];
  let changedEvents = [];
  let cancelledEvents = [];
  let suppressedMassCancellations = [];
  let healthyClubsCount = 8;
  let totalClubsCount = 8;
  let statusLogs = statusData.logs || [];
  let nextLedger = null;
  let hasSilentLedgerChanges = false;
  let bootstrapped = false;

  if (simArg) {
    clubs = simArg.replace('--simulate=', '').split(',').map(s => s.trim()).filter(Boolean);
    addedEvents = clubs.map((club, idx) => ({
      startDate: '2027-03-13',
      endDate: '2027-03-15',
      displayDate: '13-15/3',
      title: idx === 0 ? 'Ορειβατικό σκι στον Γράμμο, Πληκάτι–Τσούκα Πετσίκ–Γκέσος' : `Ανάβαση σε κορυφή ${idx + 1}`,
      club,
      url: 'https://eosacharnon.xmiddleware.com/el/booking/cmwau20z2018ft401m13rtepb',
      difficulty: 'Δ'
    }));
    const prevChanged = {
      startDate: '2026-12-11',
      endDate: '2026-12-13',
      displayDate: '11-13/12',
      title: 'Αχαϊα: Χελμός, «Χτένια»',
      club: clubs[0] || 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/sample/',
      difficulty: '1, 1+, 3, 4'
    };
    const currChanged = {
      ...prevChanged,
      startDate: '2026-12-12',
      displayDate: '12-13/12',
      difficulty: '3, 4'
    };
    changedEvents = [{
      previous: prevChanged,
      current: currChanged,
      changes: classifyEventChange(prevChanged, currChanged, currentYear)
    }];
    cancelledEvents = [{
      startDate: '2026-12-20',
      endDate: '2026-12-20',
      displayDate: '20/12',
      title: 'Πάρνηθα — Ακυρωμένη εξόρμηση δοκιμής',
      club: clubs[0] || 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/cancelled/',
      difficulty: '2'
    }];
    console.log(`[notifications] Simulated +${addedEvents.length} added, ~${changedEvents.length} changed, -${cancelledEvents.length} cancelled across: ${clubs.join(', ')}`);
  } else if (isTestAdmin) {
    clubs = ['ΕΠΟΣ Φυλής'];
    addedEvents = [{
      startDate: '2027-01-10',
      endDate: '2027-01-10',
      displayDate: '10/1',
      title: 'Νότιος Υμηττός : Τρύπια Σπηλιά – Διάσελο Σταυρού',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/sample-added/',
      difficulty: '1+'
    }];
    const prevSample = {
      startDate: '2026-12-11',
      endDate: '2026-12-13',
      displayDate: '11-13/12',
      title: 'Αχαϊα: Χελμός, «Χτένια»',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/sample-changed/',
      difficulty: '1, 1+, 3, 4'
    };
    const currSample = { ...prevSample, startDate: '2026-12-12', displayDate: '12-13/12', difficulty: '3, 4' };
    changedEvents = [{
      previous: prevSample,
      current: currSample,
      changes: classifyEventChange(prevSample, currSample, currentYear)
    }];
    console.log('[notifications] Running --test-admin mode.');
  } else {
    const existingLedger = loadJsonSafe(paths.ledgerFile, null);
    const diff = diffEventsWithLedger({
      currentEvents,
      ledger: existingLedger,
      statusData,
      clubHealth,
      todayStr,
      nowIso,
      allowMassCancel
    });
    bootstrapped = diff.bootstrapped;
    clubs = diff.clubs;
    addedEvents = diff.addedEvents;
    changedEvents = diff.changedEvents;
    cancelledEvents = diff.cancelledEvents;
    suppressedMassCancellations = diff.suppressedMassCancellations;
    healthyClubsCount = diff.healthyClubsCount;
    totalClubsCount = diff.totalClubsCount;
    statusLogs = diff.statusLogs;
    nextLedger = diff.nextLedger;
    hasSilentLedgerChanges = diff.hasSilentLedgerChanges;
  }

  // Never create filesystem side effects during --dry-run
  if (!isDryRun) {
    recordAdminChangeLog({
      addedEvents,
      changedEvents,
      cancelledEvents,
      healthyClubsCount,
      totalClubsCount,
      statusLogs,
      todayStr,
      localSummaryFile: paths.localSummaryFile
    });
  }

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const adminChatId = env.TELEGRAM_ADMIN_CHAT_ID;
  const channelId = env.TELEGRAM_CHANNEL_ID;
  const buttondownKey = env.BUTTONDOWN_API_KEY;

  const hasUserUpdates = addedEvents.length > 0 || changedEvents.length > 0 || cancelledEvents.length > 0;
  const broadcastErrors = [];
  let subscriberDeliveryStatus = null;
  let ledgerPersisted = false;

  if (bootstrapped && !isDryRun) {
    fs.writeFileSync(paths.ledgerFile, JSON.stringify(nextLedger, null, 2), 'utf-8');
    ledgerPersisted = true;
    console.log(`[notifications] Bootstrapped missing ledger (${nextLedger.events.length} events) without sending bulk alerts.`);
  } else if (hasUserUpdates) {
    const { telegramMessages, emailSubject, emailBody } = buildSubscriberMessages({
      clubs,
      addedEvents,
      changedEvents,
      cancelledEvents,
      currentYear
    });

    console.log(`\n[notifications] Changes across healthy clubs (${clubs.join(', ')}): +${addedEvents.length} added, ~${changedEvents.length} changed, -${cancelledEvents.length} cancelled`);
    for (const ev of addedEvents) {
      console.log(`  [+] [${ev.club}] ${formatEventDate(ev, currentYear)}: ${ev.title}${ev.difficulty ? ` (Β.Δ. ${ev.difficulty})` : ''}`);
    }
    for (const item of changedEvents) {
      console.log(`  [~] [${item.current.club}] ${formatEventDate(item.current, currentYear)}: ${item.current.title} (${formatChangeDetailsGreek(item.changes)})`);
    }
    for (const ev of cancelledEvents) {
      console.log(`  [-] [${ev.club}] ${formatEventDate(ev, currentYear)}: ${ev.title}`);
    }

    if (isDryRun) {
      console.log('\n--- [DRY RUN] Subscriber Telegram HTML Message(s) ---');
      for (const msg of telegramMessages) {
        console.log(msg);
        console.log(`(length: ${msg.length} chars)`);
        console.log('-------------------------------------------');
      }
      console.log('\n--- [DRY RUN] Buttondown Email Payload ---');
      console.log(`Subject: ${emailSubject}`);
      console.log(emailBody);
      subscriberDeliveryStatus = `[DRY RUN] Θα στέλνονταν: ${summarizeCountsGreek(addedEvents.length, changedEvents.length, cancelledEvents.length, clubs)}`;
    } else if (isTestAdmin) {
      if (botToken && adminChatId) {
        const footer = `\n\n<i>ℹ️ [Admin Test: +${addedEvents.length} νέες, ~${changedEvents.length} αλλαγές, -${cancelledEvents.length} ακυρώσεις]</i>`;
        const adminChunks = [...telegramMessages];
        adminChunks[adminChunks.length - 1] += footer;
        for (const chunk of adminChunks.flatMap(m => chunkHtmlText(m, 3900))) {
          await sendTelegramMessage(botToken, adminChatId, chunk, fetchImpl);
        }
        console.log(`[notifications] Sent --test-admin preview to Admin (${adminChatId}).`);
      } else {
        console.log('[notifications] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set; skipping --test-admin.');
      }
    } else {
      // 1. Public Telegram Channel Broadcast
      let telegramAttempted = false;
      let telegramSucceeded = false;
      if (botToken && channelId) {
        telegramAttempted = true;
        try {
          for (const msg of telegramMessages) {
            await sendTelegramMessage(botToken, channelId, msg, fetchImpl);
          }
          telegramSucceeded = true;
          console.log(`[notifications] Broadcast Telegram notification to Channel (${channelId}) in ${telegramMessages.length} message(s).`);
        } catch (err) {
          console.error('[notifications] Failed to broadcast to Telegram Channel:', err.message);
          broadcastErrors.push({ channel: 'Telegram Channel', message: err.message });
        }
      } else {
        console.log('[notifications] TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set; skipping channel broadcast.');
      }

      // 2. Buttondown Email Subscribers Broadcast
      let emailAttempted = false;
      let emailSucceeded = false;
      if (buttondownKey) {
        emailAttempted = true;
        try {
          await sendButtondownEmail(buttondownKey, emailSubject, emailBody, fetchImpl);
          emailSucceeded = true;
          console.log('[notifications] Triggered Buttondown email broadcast.');
        } catch (err) {
          console.error('[notifications] Failed to trigger Buttondown email broadcast:', err.message);
          broadcastErrors.push({ channel: 'Buttondown Email', message: err.message });
        }
      } else {
        console.log('[notifications] BUTTONDOWN_API_KEY not set; skipping email broadcast.');
      }

      // 3. Persist ledger ONLY if at least one configured public channel succeeded
      const anyPublicChannelSucceeded = telegramSucceeded || emailSucceeded;
      if (anyPublicChannelSucceeded && nextLedger && !simArg) {
        fs.writeFileSync(paths.ledgerFile, JSON.stringify(nextLedger, null, 2), 'utf-8');
        ledgerPersisted = true;
        console.log(`[notifications] Committed updated ledger (${nextLedger.events.length} events) to ${paths.ledgerFile}.`);
      } else if (!telegramAttempted && !emailAttempted) {
        console.warn('[notifications] No public channel credentials configured — NOT advancing notification ledger.');
      } else if (!anyPublicChannelSucceeded) {
        console.error('[notifications] All public broadcasts failed — keeping pending events un-notified in ledger for automatic retry.');
      }

      const tgBadge = telegramAttempted ? (telegramSucceeded ? '✅' : '❌') : '⏭️';
      const emBadge = emailAttempted ? (emailSucceeded ? '✅' : '❌') : '⏭️';
      const countsText = summarizeCountsGreek(addedEvents.length, changedEvents.length, cancelledEvents.length, clubs);
      if (anyPublicChannelSucceeded) {
        subscriberDeliveryStatus = broadcastErrors.length > 0
          ? `Στάλθηκαν μερικώς (ένα κανάλι απέτυχε): ${countsText}`
          : `Στάλθηκαν: ${countsText}`;
      } else if (telegramAttempted || emailAttempted) {
        subscriberDeliveryStatus = `ΑΠΕΤΥΧΕ η αποστολή (${countsText}) — θα ξαναγίνει προσπάθεια στο επόμενο run.`;
      } else {
        subscriberDeliveryStatus = `Δεν στάλθηκαν (λείπουν credentials): ${countsText}`;
      }

      // 4. Send Admin copy of the broadcast (safely chunked!)
      if (botToken && adminChatId) {
        try {
          const adminFooter = `\n\n<i>ℹ️ [Admin: +${addedEvents.length} νέες, ~${changedEvents.length} αλλαγές, -${cancelledEvents.length} ακυρώσεις | ${healthyClubsCount}/${totalClubsCount} σύλλογοι OK | Telegram: ${tgBadge} | Email: ${emBadge}]</i>`;
          const adminChunks = [...telegramMessages];
          adminChunks[adminChunks.length - 1] += adminFooter;
          for (const chunk of adminChunks.flatMap(m => chunkHtmlText(m, 3900))) {
            await sendTelegramMessage(botToken, adminChatId, chunk, fetchImpl);
          }
          console.log(`[notifications] Sent broadcast summary to Admin (${adminChatId}).`);
        } catch (err) {
          console.error('[notifications] Failed to send Admin broadcast summary:', err.message);
        }
      }
    }
  } else {
    console.log('[notifications] No new, changed, or cancelled upcoming events across healthy clubs.');
    // Still persist silent ledger housekeeping (expired events, URL slug refreshes, blank->filled difficulty)
    if (!isDryRun && !isTestAdmin && !simArg && hasSilentLedgerChanges && nextLedger) {
      fs.writeFileSync(paths.ledgerFile, JSON.stringify(nextLedger, null, 2), 'utf-8');
      ledgerPersisted = true;
      console.log(`[notifications] Saved silent ledger maintenance (${nextLedger.events.length} events).`);
    }
  }

  // Send Plain-Language Admin Health / Recovery / Self-Heal / Delivery-Error / Mass-Cancel Alert
  let adminHealthAlertSent = false;
  if ((isScrapeRun || isSelfHealPush || broadcastErrors.length > 0 || suppressedMassCancellations.length > 0 || isTestAlert) && !isTestAdmin && !simArg) {
    const adminHealthChunks = buildAdminHealthAlert({
      clubHealth,
      statusData,
      statusLogs,
      suppressedMassCancellations,
      subscriberSummary: subscriberDeliveryStatus,
      runUrl,
      issueUrl,
      issueAction,
      healthyClubsCount,
      totalClubsCount,
      broadcastErrors,
      isScrapeRun,
      isSelfHealPush,
      isTestAlert
    });

    if (adminHealthChunks && adminHealthChunks.length > 0) {
      if (isDryRun) {
        console.log('\n--- [DRY RUN] Plain-Language Admin Health Alert ---');
        for (const chunk of adminHealthChunks) {
          console.log(chunk);
          console.log(`(length: ${chunk.length} chars)`);
        }
      } else if (botToken && adminChatId) {
        try {
          for (const chunk of adminHealthChunks) {
            await sendTelegramMessage(botToken, adminChatId, chunk, fetchImpl);
          }
          adminHealthAlertSent = true;
          console.log(`[notifications] Sent plain-language Admin health alert (${adminHealthChunks.length} msg) to Admin (${adminChatId}).`);
        } catch (err) {
          console.error('[notifications] Failed to send Admin health alert:', err.message);
        }
      }
    }
  }

  return {
    bootstrapped,
    hasUserUpdates,
    addedCount: addedEvents.length,
    changedCount: changedEvents.length,
    cancelledCount: cancelledEvents.length,
    suppressedMassCancellations,
    broadcastErrors,
    ledgerPersisted,
    adminHealthAlertSent
  };
}

export async function main() {
  return runNotifications();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch(err => {
    console.error('[notifications] Unexpected error:', err);
    process.exit(0); // Never fail CI deploy because of notification error
  });
}
