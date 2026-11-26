import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAthensToday, isValidCalendarDate } from './lib/event-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PATHS = {
  eventsFile: path.join(__dirname, '../src/data/events.json'),
  baselineFile: path.join(__dirname, '../src/data/health-baseline.json'),
  statusFile: path.join(__dirname, '../src/data/status.json'),
  clubHealthFile: path.join(__dirname, '../src/data/club-health.json'),
  linkConfigFile: path.join(__dirname, '../_input/link-config.json'),
  linksMdFile: path.join(__dirname, '../LINKS.md'),
  currentHashesFile: path.join(__dirname, '../src/data/content-hashes.json'),
  oldHashesFile: path.join(__dirname, '../src/data/content-hashes-old.json'),
  reportFile: path.join(__dirname, '../src/data/anomaly_report.md')
};

export const FETCH_FALLBACK_ESCALATION_RUNS = 2;

export function loadLinkConfig(linkConfigFile = DEFAULT_PATHS.linkConfigFile, linksMdFile = DEFAULT_PATHS.linksMdFile) {
  if (fs.existsSync(linkConfigFile)) {
    try {
      return JSON.parse(fs.readFileSync(linkConfigFile, 'utf-8'));
    } catch {
      // Fallback to LINKS.md below
    }
  }
  const config = {};
  if (fs.existsSync(linksMdFile)) {
    const lines = fs.readFileSync(linksMdFile, 'utf-8').split('\n');
    let currentClub = '';
    const urlRegex = /https?:\/\/[^\s]+/i;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) {
        currentClub = trimmed.replace(/^#\s*/, '').trim();
        config[currentClub] = [];
      } else if (trimmed.startsWith('-') && currentClub) {
        const match = trimmed.match(urlRegex);
        if (match) {
          config[currentClub].push(match[0].replace(/[,;()]$/, '').trim());
        }
      }
    }
  }
  return config;
}

function loadJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function buildFetchErrorText(log) {
  if (log.fetchErrorSummary) return log.fetchErrorSummary;
  if (Array.isArray(log.fetch)) {
    const failed = log.fetch.filter(f => !f.success);
    if (failed.length > 0) {
      return [...new Set(failed.map(f => {
        if (f.code === 403 && /cloudflare|anti-bot|challenge/i.test(f.status || '')) {
          return 'HTTP 403 (Cloudflare / anti-bot)';
        }
        return f.code ? `HTTP ${f.code} (${f.status || 'error'})` : (f.status || 'Network error');
      }))].join('; ');
    }
  }
  return log.details || 'Fetch failed';
}

export function detectAnomalies(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...(options.paths || {}) };
  const isTestMode = options.testAlert ?? (process.argv.includes('--test-alert') || process.env.TEST_ANOMALY === '1');
  const acceptBaselineMode = options.acceptBaseline ?? process.argv.includes('--accept-baseline');
  const todayStr = options.todayStr || getAthensToday();
  const TODAY = new Date(todayStr);
  const TWO_YEARS_AHEAD = new Date(TODAY);
  TWO_YEARS_AHEAD.setFullYear(TWO_YEARS_AHEAD.getFullYear() + 2);
  const nowIso = options.nowIso || new Date().toISOString();

  if (!fs.existsSync(paths.eventsFile)) {
    console.log('Skipping anomaly detection: events file missing.');
    return { hasCriticalAnomalies: false, clubHealth: null };
  }

  const newEvents = loadJsonSafe(paths.eventsFile, []);
  const linkConfig = loadLinkConfig(paths.linkConfigFile, paths.linksMdFile);
  const statusData = loadJsonSafe(paths.statusFile, { logs: [] });
  const currentHashes = loadJsonSafe(paths.currentHashesFile, {});
  const oldHashes = loadJsonSafe(paths.oldHashesFile, {});
  const prevClubHealth = loadJsonSafe(paths.clubHealthFile, { version: 1, lastProcessedStatusTimestamp: null, clubs: {} });
  let healthBaseline = loadJsonSafe(paths.baselineFile, {});

  // Prevent double-counting consecutive failures when detect-anomalies.js is re-run
  // on the exact same status.json (e.g. `npm run test:anomalies` right after `npm run scrape`).
  const statusTimestamp = statusData.lastUpdated || null;
  const isSameScrapeRun = Boolean(statusTimestamp && prevClubHealth.lastProcessedStatusTimestamp === statusTimestamp);

  const criticalAnomalies = [];
  const transientNotices = [];
  const notifications = [];
  const warnings = [];

  if (isTestMode) {
    criticalAnomalies.push(
      `- **🧪 [TEST ALERT] Notification Pipeline Verification:** Intentional test alert to verify GitHub Issue creation, Admin Telegram alerting, and self-healing triage.`
    );
  }

  // Parse club status from status.json (supports both new structured fields and legacy details strings)
  const clubStatusMap = {};
  for (const log of (statusData.logs || [])) {
    const details = log.details || '';
    const parsedMatch = details.match(/Parsed (\d+) events/i) || details.match(/(\d+) parsed/i);
    const preservedMatch = details.match(/preserved (\d+) healthy events/i);

    const parsedCount = typeof log.parsedCount === 'number'
      ? log.parsedCount
      : (parsedMatch ? parseInt(parsedMatch[1], 10) : 0);
    const preservedCount = typeof log.preservedCount === 'number'
      ? log.preservedCount
      : (preservedMatch ? parseInt(preservedMatch[1], 10) : 0);
    const fetchFailed = typeof log.fetchFailed === 'boolean'
      ? log.fetchFailed
      : (Array.isArray(log.fetch) ? log.fetch.some(f => !f.success) : /bot challenge|network error|partial fetch error/i.test(details));

    clubStatusMap[log.club] = {
      status: log.status,
      parsedCount,
      preservedCount,
      totalCount: parsedCount + preservedCount,
      fallback: log.fallback || (preservedCount > 0 ? (parsedCount > 0 ? 'partial' : 'full') : 'none'),
      fetchFailed,
      fetchErrorSummary: fetchFailed ? buildFetchErrorText(log) : null,
      details
    };
  }

  // Group current events by club
  const newByClub = {};
  for (const ev of newEvents) {
    if (!newByClub[ev.club]) newByClub[ev.club] = [];
    newByClub[ev.club].push(ev);
  }

  const criticalClubs = new Set();
  const transientFallbackClubs = new Set();
  const degradedClubs = new Set();
  const nextClubsHealth = {};

  // 1. Evaluate fetch status, resilience fallbacks, and parser failures per club
  for (const club in linkConfig) {
    const clubInfo = clubStatusMap[club] || {
      status: 'unknown',
      parsedCount: 0,
      preservedCount: 0,
      totalCount: 0,
      fallback: 'none',
      fetchFailed: false,
      fetchErrorSummary: null,
      details: 'No status entry found'
    };
    const prevClub = prevClubHealth.clubs?.[club] || {};
    const clubUrls = linkConfig[club] || [];
    const baseUpcomingCount = (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY).length;

    const contentChangedUrls = [];
    for (const url of clubUrls) {
      if (oldHashes[url] && currentHashes[url] && oldHashes[url] !== currentHashes[url]) {
        contentChangedUrls.push(url);
      }
    }

    const isFallback = clubInfo.status === 'warning' && clubInfo.preservedCount > 0;

    if (isFallback && clubInfo.fetchFailed) {
      // Transient or persistent fetch/IP-block fallback — escalate only after 2 consecutive runs!
      const prevFallbacks = prevClub.consecutiveFetchFallbacks || 0;
      const consecutiveFetchFallbacks = isSameScrapeRun ? Math.max(1, prevFallbacks) : prevFallbacks + 1;
      const consecutiveFailures = isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1;
      degradedClubs.add(club);

      if (consecutiveFetchFallbacks >= FETCH_FALLBACK_ESCALATION_RUNS) {
        criticalClubs.add(club);
        criticalAnomalies.push(
          `- **🟠 Persistent Fetch Block for ${club} (${consecutiveFetchFallbacks} consecutive runs):** ${clubInfo.fetchErrorSummary}. Serving ${clubInfo.preservedCount} cached baseline event(s) via fallback.`
        );
        nextClubsHealth[club] = {
          status: 'critical_fallback',
          consecutiveFetchFallbacks,
          consecutiveFailures,
          lastHealthyAt: prevClub.lastHealthyAt || null,
          lastError: clubInfo.fetchErrorSummary,
          parsedCount: clubInfo.parsedCount,
          preservedCount: clubInfo.preservedCount,
          baselineCount: baseUpcomingCount,
          recommendedAction: 'local_self_heal'
        };
      } else {
        transientFallbackClubs.add(club);
        transientNotices.push(
          `- **🟡 Transient Fetch Block for ${club} (Run ${consecutiveFetchFallbacks}/${FETCH_FALLBACK_ESCALATION_RUNS}):** ${clubInfo.fetchErrorSummary}. Preserved ${clubInfo.preservedCount} cached event(s) via fallback — waiting for next run before opening an issue.`
        );
        nextClubsHealth[club] = {
          status: 'transient_fallback',
          consecutiveFetchFallbacks,
          consecutiveFailures,
          lastHealthyAt: prevClub.lastHealthyAt || null,
          lastError: clubInfo.fetchErrorSummary,
          parsedCount: clubInfo.parsedCount,
          preservedCount: clubInfo.preservedCount,
          baselineCount: baseUpcomingCount,
          recommendedAction: 'wait_next_run'
        };
      }
    } else if (isFallback && !clubInfo.fetchFailed) {
      // HTTP 200 succeeded, yet parser extracted 0 events and fell back to cache -> real parser/site change!
      const consecutiveFailures = isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1;
      degradedClubs.add(club);
      criticalClubs.add(club);
      const changedNote = contentChangedUrls.length > 0 ? ` Website HTML changed (${contentChangedUrls.join(', ')}).` : '';
      criticalAnomalies.push(
        `- **🚨 Parser Returned 0 Events on HTTP 200 for ${club}:** Page fetched OK, but 0 events were parsed (serving ${clubInfo.preservedCount} cached baseline event(s) via fallback).${changedNote} Possible DOM/selector or seasonal URL change.`
      );
      nextClubsHealth[club] = {
        status: 'parser_error',
        consecutiveFetchFallbacks: 0,
        consecutiveFailures,
        lastHealthyAt: prevClub.lastHealthyAt || null,
        lastError: 'HTTP 200 OK but parser returned 0 events',
        parsedCount: 0,
        preservedCount: clubInfo.preservedCount,
        baselineCount: baseUpcomingCount,
        recommendedAction: 'fix_parser_or_url'
      };
    } else if (clubInfo.totalCount === 0 || clubInfo.status === 'error') {
      const consecutiveFailures = isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1;
      degradedClubs.add(club);
      criticalClubs.add(club);
      if (contentChangedUrls.length > 0) {
        criticalAnomalies.push(
          `- **🚨 CRITICAL: Website Updated But Parser Returned 0 Events for ${club}:** Content changed (${contentChangedUrls.join(', ')}), parser returned 0 events and no baseline fallback is available.`
        );
      } else if (clubInfo.fetchFailed) {
        criticalAnomalies.push(
          `- **🚨 Complete Data Loss for ${club}:** Fetch failed (${clubInfo.fetchErrorSummary}) and no cached baseline events remain.`
        );
      } else {
        criticalAnomalies.push(
          `- **🚨 Complete Data Loss for ${club}:** Parser returned 0 events on HTTP 200 and no cached baseline events remain.`
        );
      }
      nextClubsHealth[club] = {
        status: clubInfo.fetchFailed ? 'data_loss' : 'parser_error',
        consecutiveFetchFallbacks: clubInfo.fetchFailed
          ? (isSameScrapeRun ? Math.max(1, prevClub.consecutiveFetchFallbacks || 0) : (prevClub.consecutiveFetchFallbacks || 0) + 1)
          : 0,
        consecutiveFailures,
        lastHealthyAt: prevClub.lastHealthyAt || null,
        lastError: clubInfo.fetchFailed ? clubInfo.fetchErrorSummary : 'Parser returned 0 events (no baseline fallback)',
        parsedCount: 0,
        preservedCount: 0,
        baselineCount: baseUpcomingCount,
        recommendedAction: clubInfo.fetchFailed ? 'local_self_heal' : 'fix_parser_or_url'
      };
    } else {
      if (contentChangedUrls.length > 0) {
        notifications.push(
          `- **📢 Website Content Updated for ${club}:** Webpage content changed (${contentChangedUrls.join(', ')}). Successfully parsed ${clubInfo.parsedCount} events.`
        );
      }
      nextClubsHealth[club] = {
        status: 'healthy',
        consecutiveFetchFallbacks: 0,
        consecutiveFailures: 0,
        lastHealthyAt: statusTimestamp || nowIso,
        lastError: null,
        parsedCount: clubInfo.parsedCount,
        preservedCount: 0,
        baselineCount: baseUpcomingCount,
        recommendedAction: null
      };
    }
  }

  // 2. Sensitive Drop Detection against Persistent Healthy Baseline (HTTP 200 healthy clubs only)
  for (const club in linkConfig) {
    if (criticalClubs.has(club) || transientFallbackClubs.has(club)) continue;

    const baseClubEvents = (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY);
    const newClubEvents = newByClub[club] || [];
    const prevClub = prevClubHealth.clubs?.[club] || {};

    if (baseClubEvents.length > 0 && newClubEvents.length === 0) {
      degradedClubs.add(club);
      criticalClubs.add(club);
      criticalAnomalies.push(
        `- **🚨 Complete Data Loss for ${club}:** Had ${baseClubEvents.length} upcoming events in healthy baseline, but 0 today on HTTP 200!`
      );
      nextClubsHealth[club] = {
        ...nextClubsHealth[club],
        status: 'parser_error',
        consecutiveFailures: isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1,
        lastHealthyAt: prevClub.lastHealthyAt || null,
        lastError: `Dropped from ${baseClubEvents.length} to 0 upcoming events on HTTP 200`,
        recommendedAction: 'fix_parser_or_url'
      };
    } else if (baseClubEvents.length >= 2 && (baseClubEvents.length - newClubEvents.length) >= 2) {
      if (acceptBaselineMode && newClubEvents.length > 0) {
        console.log(`ℹ️ [--accept-baseline] Accepting new event count for ${club} (${baseClubEvents.length} -> ${newClubEvents.length}).`);
      } else {
        degradedClubs.add(club);
        criticalClubs.add(club);
        criticalAnomalies.push(
          `- **⚠️ Event Count Drop for ${club}:** Scheduled upcoming events dropped by ${baseClubEvents.length - newClubEvents.length} (was ${baseClubEvents.length} in healthy baseline, now ${newClubEvents.length}) on HTTP 200. Check whether excursions were cancelled or the parser missed them.`
        );
        nextClubsHealth[club] = {
          ...nextClubsHealth[club],
          status: 'event_drop',
          consecutiveFailures: isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1,
          lastHealthyAt: prevClub.lastHealthyAt || null,
          lastError: `Upcoming events dropped from ${baseClubEvents.length} to ${newClubEvents.length} on HTTP 200`,
          recommendedAction: 'verify_drop_or_accept_baseline'
        };
      }
    }
  }

  // 3. Overall drastic drop against baseline
  let totalUpcomingBase = 0;
  for (const club in healthBaseline) {
    totalUpcomingBase += (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY).length;
  }
  const totalNew = newEvents.length;

  if (!acceptBaselineMode && totalUpcomingBase >= 10 && totalNew < Math.floor(totalUpcomingBase / 2)) {
    criticalAnomalies.push(
      `- **🚨 Massive Overall Data Loss:** Total upcoming events dropped from ${totalUpcomingBase} in healthy baseline to ${totalNew} today!`
    );
  }

  // 4. Data Quality & Date Validity Checks
  const invalidDateClubs = new Set();
  for (const ev of newEvents) {
    const startInvalid = !isValidCalendarDate(ev.startDate);
    const endInvalid = Boolean(ev.endDate && !isValidCalendarDate(ev.endDate));
    const endBeforeStart = Boolean(!startInvalid && !endInvalid && ev.endDate && ev.endDate < ev.startDate);
    if (startInvalid || endInvalid || endBeforeStart) {
      const clubKey = ev.club || '__unknown__';
      const dateErrDetail = startInvalid
        ? `Invalid startDate "${ev.startDate}"`
        : (endInvalid ? `Invalid endDate "${ev.endDate}"` : `endDate "${ev.endDate}" precedes startDate "${ev.startDate}"`);
      if (!invalidDateClubs.has(clubKey)) {
        invalidDateClubs.add(clubKey);
        if (ev.club) {
          const prevClub = prevClubHealth.clubs?.[ev.club] || {};
          degradedClubs.add(ev.club);
          criticalClubs.add(ev.club);
          nextClubsHealth[ev.club] = {
            ...(nextClubsHealth[ev.club] || {}),
            status: 'parser_error',
            consecutiveFailures: isSameScrapeRun ? Math.max(1, prevClub.consecutiveFailures || 0) : (prevClub.consecutiveFailures || 0) + 1,
            lastError: `${dateErrDetail} on "${ev.title}"`,
            recommendedAction: 'fix_parser_or_url'
          };
        }
        criticalAnomalies.push(
          `- **🚨 Invalid Date Format:** Event "${ev.title}" for club ${ev.club} has ${dateErrDetail}.`
        );
      }
      continue;
    }

    const dStart = new Date(ev.startDate);
    const dEnd = new Date(ev.endDate || ev.startDate);

    if (dEnd < TODAY && dStart < TODAY) {
      warnings.push(`- **Past Event Included:** "${ev.title}" (${ev.club}) dated ${ev.startDate} is in the past.`);
    }
    if (dStart > TWO_YEARS_AHEAD) {
      warnings.push(`- **Suspicious Distant Date:** "${ev.title}" (${ev.club}) is dated ${ev.startDate} (> 2 years in the future). Check year resolution.`);
    }
    if (!ev.title || ev.title.trim().length < 3) {
      warnings.push(`- **Empty / Short Title:** Event for club ${ev.club} on ${ev.startDate} has invalid title "${ev.title}".`);
    }
    if (!ev.url || !ev.url.startsWith('http')) {
      warnings.push(`- **Missing or Invalid URL:** Event "${ev.title}" (${ev.club}) has invalid URL "${ev.url}".`);
    }
  }

  // 5. Stale Program Check (no events in next 45 days)
  const in45Days = new Date(TODAY);
  in45Days.setDate(in45Days.getDate() + 45);

  for (const club in linkConfig) {
    const clubEvents = newByClub[club] || [];
    const hasSoonEvents = clubEvents.some(e => {
      const d = new Date(e.startDate);
      return d >= TODAY && d <= in45Days;
    });

    if (clubEvents.length > 0 && !hasSoonEvents) {
      warnings.push(
        `- **📅 Stale Program Warning for ${club}:** Has ${clubEvents.length} events scheduled, but none in the next 45 days. The seasonal program may have concluded and a new schedule might be available on their site.`
      );
    }
  }

  // 6. Update Health Baseline ONLY for completely healthy clubs (skip writes in --test-alert mode)
  if (!isTestMode) {
    for (const club in linkConfig) {
      if (!degradedClubs.has(club) && newByClub[club] && newByClub[club].length > 0) {
        healthBaseline[club] = newByClub[club];
        if (nextClubsHealth[club]) {
          nextClubsHealth[club].baselineCount = newByClub[club].length;
        }
      }
    }
    fs.writeFileSync(paths.baselineFile, JSON.stringify(healthBaseline, null, 2), 'utf-8');
  }

  const hasCriticalAnomalies = criticalAnomalies.length > 0;
  const overallStatus = hasCriticalAnomalies
    ? 'critical'
    : (degradedClubs.size > 0 ? 'degraded' : 'healthy');

  const baselineAcceptedForTimestamp = acceptBaselineMode
    ? statusTimestamp
    : (isSameScrapeRun && prevClubHealth.baselineAcceptedForTimestamp === statusTimestamp
        ? prevClubHealth.baselineAcceptedForTimestamp
        : null);

  const clubHealthOutput = {
    version: 1,
    lastRunAt: nowIso,
    lastProcessedStatusTimestamp: statusTimestamp,
    baselineAcceptedForTimestamp,
    overallStatus,
    hasCriticalAnomalies,
    degradedClubs: Array.from(degradedClubs),
    transientFallbackClubs: Array.from(transientFallbackClubs),
    criticalClubs: Array.from(criticalClubs),
    clubs: nextClubsHealth
  };

  if (!isTestMode) {
    fs.writeFileSync(paths.clubHealthFile, JSON.stringify(clubHealthOutput, null, 2), 'utf-8');
  }

  // Summary Table Generation
  const clubSummaryRows = Object.keys(linkConfig).map(club => {
    const evList = newByClub[club] || [];
    const count = evList.length;
    const earliest = evList.length > 0 ? evList[0].startDate : '-';
    const latest = evList.length > 0 ? evList[evList.length - 1].startDate : '-';
    const baseCount = (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY).length;
    const cStatus = nextClubsHealth[club]?.status;
    let statusIcon = '✅ Healthy';
    if (cStatus === 'transient_fallback') {
      statusIcon = `🟡 Fallback (1/${FETCH_FALLBACK_ESCALATION_RUNS})`;
    } else if (cStatus === 'critical_fallback') {
      statusIcon = `🟠 Fallback (${nextClubsHealth[club].consecutiveFetchFallbacks} runs)`;
    } else if (criticalClubs.has(club)) {
      statusIcon = '🚨 Alert';
    }
    return `| ${club} | ${count} | ${baseCount} | ${statusIcon} | ${earliest} | ${latest} |`;
  });

  const summaryTable = [
    `| Club | Active Events | Healthy Baseline | Status | Next Event | Furthest Event |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: |`,
    ...clubSummaryRows
  ].join('\n');

  if (hasCriticalAnomalies) {
    const failingClubs = Array.from(criticalClubs);
    const targetClubsLabel = failingClubs.length > 0 ? failingClubs.join(', ') : 'affected clubs';
    const affectedClubUrls = failingClubs.map(c => {
      const urls = linkConfig[c] || [];
      return `- **${c}:** ${urls.join(', ') || 'N/A'}`;
    }).join('\n');

    const onlyPersistentFetchBlocks = failingClubs.length > 0 && failingClubs.every(
      c => nextClubsHealth[c]?.recommendedAction === 'local_self_heal'
    );

    const bestOptionGuidance = onlyPersistentFetchBlocks
      ? [
          `1. **Best option (automatic):** Leave it for the **Mount Athens Self-Heal** local monitor on your Mac — it runs from your residential IP (bypassing Cloudflare datacenter blocks), commits the fresh events, and closes this issue automatically.`,
          `2. **If your Mac is asleep/away:** Next time you are at your Mac, run \`npm run scrape && git push\` (or wait for the next scheduled run to see if the IP block lifts).`,
          `3. **User impact:** None for existing excursions — cached baseline events remain live on the site, and healthy clubs continue notifying subscribers normally.`
        ].join('\n')
      : [
          `1. **If a club website layout or URL changed (HTTP 200 + 0 events / parser error):** Dispatch the Antigravity Remote Agent using the prompt below to inspect \`_input/\` and fix that club's parser.`,
          `2. **If a club legitimately cancelled/removed hikes (Event Count Drop on HTTP 200):** Verify on the club's website and run \`npm run baseline:accept\` so cancellation notifications can be sent cleanly.`,
          `3. **User impact:** Affected clubs are protected by fallback / cancellation suppression; healthy clubs continue working and notifying subscribers normally.`
        ].join('\n');

    const plainAlerts = criticalAnomalies.map(a => a.replace(/\*\*/g, '')).join('\n');
    const categories = [...new Set(failingClubs.map(c => nextClubsHealth[c]?.status || 'unknown'))];

    const agentPrompt = `Triage and resolve the Mount Athens scraping anomaly for: ${targetClubsLabel}.

Reported Anomaly:
${plainAlerts}

Affected Sources:
${affectedClubUrls ? affectedClubUrls.replace(/\*\*/g, '') : '- See LINKS.md'}

Instructions (follow .gemini/rules/anomaly-triage.md):
1. Bootstrap cloud sandbox and reproduce: run \`npm install && npm run scrape\`.
2. Diagnose the root cause for ${targetClubsLabel}:
   - Case A (DOM / regex / API schema changed): Update the club parser in \`scripts/parse-events.js\` and run \`npm run scrape:parse\`.
   - Case B (New seasonal schedule URL published): Update \`LINKS.md\` and run \`npm run scrape\`.
   - Case C (Legitimate schedule reduction — club cancelled or removed hikes on their website): Do not modify \`scripts/parse-events.js\`; run \`npm run baseline:accept\` to accept the new event count in \`src/data/health-baseline.json\`.
3. Verify \`npm run test:anomalies\` reports 0 critical alerts and \`npm run build\` succeeds.
4. Commit the updated files, log under [Unreleased] in CHANGELOG.md, and open a Pull Request.`;

    const metadataComment = `<!-- mount-athens-anomaly clubs="${failingClubs.join(',')}" categories="${categories.join(',')}" fetch-fallback-only="${onlyPersistentFetchBlocks}" -->`;

    const reportBody = `${metadataComment}
### ⚠️ Data Parsing Anomaly Detected

Attention: @kostis-kounadis

### 🧭 Plain-Language Summary & Best Next Option
${bestOptionGuidance}

### 🚨 Critical Alerts
${criticalAnomalies.join('\n')}

${transientNotices.length > 0 ? `### 🟡 Transient Fallbacks (Monitoring — Run 1/${FETCH_FALLBACK_ESCALATION_RUNS})\n${transientNotices.join('\n')}\n\n` : ''}${notifications.length > 0 ? `### 📢 Website Updates Detected\n${notifications.join('\n')}\n\n` : ''}${warnings.length > 0 ? `### ℹ️ Warnings\n${warnings.join('\n')}\n\n` : ''}### 📊 Club Overview
${summaryTable}

### 🔗 Affected Club Sources
${affectedClubUrls || '- None specified'}

### 🤖 Self-Healing Repair with Antigravity Remote Agent
To triage and fix parser/URL changes on the go, open your **Mount-Athens** Remote Project at [antigravity.google.com](https://antigravity.google.com) and paste this prompt:

\`\`\`text
${agentPrompt}
\`\`\`

*When all clubs recover on a subsequent scrape, this issue will be commented and closed automatically.*`;

    fs.writeFileSync(paths.reportFile, reportBody, 'utf-8');
    console.log(`\n🚨 Critical anomalies detected! Wrote alert report to ${paths.reportFile}`);
  } else {
    if (fs.existsSync(paths.reportFile)) fs.unlinkSync(paths.reportFile);
    if (transientNotices.length > 0) {
      console.log(`\n🟡 Transient fetch fallback(s) active (Run 1/${FETCH_FALLBACK_ESCALATION_RUNS}) — cached baseline served; NOT escalating to GitHub Issue yet:`);
      console.log(transientNotices.join('\n'));
    } else {
      console.log('\n✅ All good! No anomalies detected across all clubs.');
    }
    if (notifications.length > 0) {
      console.log(`\n📢 Website Updates (${notifications.length}):\n${notifications.join('\n')}`);
    }
    if (warnings.length > 0) {
      console.log(`\nℹ️ Warnings (${warnings.length}):\n${warnings.join('\n')}`);
    }
    console.log(`\n📊 Club Overview:\n${summaryTable}`);
  }

  return {
    hasCriticalAnomalies,
    criticalAnomalies,
    transientNotices,
    warnings,
    notifications,
    clubHealth: clubHealthOutput
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  detectAnomalies();
}
