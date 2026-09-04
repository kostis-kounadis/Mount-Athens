import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEW_FILE = path.join(__dirname, '../src/data/events.json');
const BASELINE_FILE = path.join(__dirname, '../src/data/health-baseline.json');
const STATUS_FILE = path.join(__dirname, '../src/data/status.json');
const LINK_CONFIG_FILE = path.join(__dirname, '../_input/link-config.json');
const CURRENT_HASHES_FILE = path.join(__dirname, '../src/data/content-hashes.json');
const OLD_HASHES_FILE = path.join(__dirname, '../src/data/content-hashes-old.json');
const REPORT_FILE = path.join(__dirname, '../src/data/anomaly_report.md');

// Current Athens date
const athensFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const TODAY = new Date(athensFormatter.format(new Date()));
const TWO_YEARS_AHEAD = new Date(TODAY);
TWO_YEARS_AHEAD.setFullYear(TWO_YEARS_AHEAD.getFullYear() + 2);

function detectAnomalies() {
  if (!fs.existsSync(NEW_FILE)) {
    console.log('Skipping anomaly detection: events file missing.');
    return;
  }

  const newEvents = JSON.parse(fs.readFileSync(NEW_FILE, 'utf-8'));
  const linkConfig = fs.existsSync(LINK_CONFIG_FILE) ? JSON.parse(fs.readFileSync(LINK_CONFIG_FILE, 'utf-8')) : {};
  const statusData = fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) : { logs: [] };
  const currentHashes = fs.existsSync(CURRENT_HASHES_FILE) ? JSON.parse(fs.readFileSync(CURRENT_HASHES_FILE, 'utf-8')) : {};
  const oldHashes = fs.existsSync(OLD_HASHES_FILE) ? JSON.parse(fs.readFileSync(OLD_HASHES_FILE, 'utf-8')) : {};

  // Load persistent health baseline (last known healthy state per club)
  let healthBaseline = {};
  if (fs.existsSync(BASELINE_FILE)) {
    try {
      healthBaseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse health-baseline.json, will reinitialize.');
    }
  }

  const criticalAnomalies = [];
  const notifications = [];
  const warnings = [];

  // Support intentional test alert via CLI arg or ENV
  const isTestMode = process.argv.includes('--test-alert') || process.env.TEST_ANOMALY === '1';
  if (isTestMode) {
    criticalAnomalies.push(`- **🧪 [TEST ALERT] Notification Pipeline Verification:** This is an intentional test alert to verify that GitHub Issues creation, Assignee mention (@kostis-kounadis), and GitHub Actions failure email notifications are working end-to-end.`);
  }

  // Map club status from status.json
  const clubStatusMap = {};
  for (const log of (statusData.logs || [])) {
    const parsedMatch = (log.details || '').match(/Parsed (\d+) events/);
    const parsedCount = parsedMatch ? parseInt(parsedMatch[1], 10) : 0;
    clubStatusMap[log.club] = {
      status: log.status,
      parsedCount,
      details: log.details
    };
  }

  // Group new events by club
  const newByClub = {};
  for (const ev of newEvents) {
    if (!newByClub[ev.club]) newByClub[ev.club] = [];
    newByClub[ev.club].push(ev);
  }

  const clubsWithAnomalies = new Set();

  // 1. Check all HTML updates & zero-event failures
  for (const club in linkConfig) {
    const clubInfo = clubStatusMap[club] || { parsedCount: 0, status: 'unknown' };
    const clubUrls = linkConfig[club] || [];
    
    let contentChangedUrls = [];
    for (const url of clubUrls) {
      if (oldHashes[url] && currentHashes[url] && oldHashes[url] !== currentHashes[url]) {
        contentChangedUrls.push(url);
      }
    }

    if (clubInfo.parsedCount === 0 || clubInfo.status === 'error') {
      clubsWithAnomalies.add(club);
      if (contentChangedUrls.length > 0) {
        criticalAnomalies.push(`- **🚨 CRITICAL: Website Updated But Parser Returned 0 Events for ${club}:** The club updated its website content overnight (${contentChangedUrls.join(', ')}), but the parser returned 0 events! Possible HTML selector or layout change.`);
      } else {
        criticalAnomalies.push(`- **⚠️ Complete Data Loss for ${club}:** Parser returned 0 events for configured club.`);
      }
    } else if (contentChangedUrls.length > 0) {
      // Club updated their HTML and parsed events successfully -> Alert the user
      notifications.push(`- **📢 Website Content Updated for ${club}:** The webpage content was updated overnight (${contentChangedUrls.join(', ')}). Successfully parsed ${clubInfo.parsedCount} events.`);
    }
  }

  // 2. Sensitive Drop Detection against Persistent Healthy Baseline
  for (const club in linkConfig) {
    if (clubsWithAnomalies.has(club)) continue;

    const baseClubEvents = (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY);
    const newClubEvents = newByClub[club] || [];

    if (baseClubEvents.length > 0 && newClubEvents.length === 0) {
      clubsWithAnomalies.add(club);
      criticalAnomalies.push(`- **🚨 Complete Data Loss for ${club}:** Had ${baseClubEvents.length} upcoming events in healthy baseline, but 0 today!`);
    } else if (baseClubEvents.length >= 2 && (baseClubEvents.length - newClubEvents.length) >= 2) {
      // Even a drop of -2 events against baseline triggers an alert
      clubsWithAnomalies.add(club);
      criticalAnomalies.push(`- **⚠️ Event Count Drop for ${club}:** Scheduled upcoming events dropped by ${baseClubEvents.length - newClubEvents.length} (was ${baseClubEvents.length} in last healthy baseline, now ${newClubEvents.length}). Check if events were cancelled, removed, or parser missed them.`);
    }
  }

  // 3. Overall drastic drop against baseline
  let totalUpcomingBase = 0;
  for (const club in healthBaseline) {
    totalUpcomingBase += (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY).length;
  }
  const totalNew = newEvents.length;

  if (totalUpcomingBase >= 10 && totalNew < Math.floor(totalUpcomingBase / 2)) {
    criticalAnomalies.push(`- **🚨 Massive Overall Data Loss:** Total upcoming events dropped from ${totalUpcomingBase} in healthy baseline to ${totalNew} today!`);
  }

  // 4. Data Quality & Date Validity Checks
  for (const ev of newEvents) {
    // Malformed date
    if (!ev.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(ev.startDate) || isNaN(new Date(ev.startDate).getTime())) {
      criticalAnomalies.push(`- **Invalid Date Format:** Event "${ev.title}" for club ${ev.club} has invalid startDate "${ev.startDate}".`);
      break;
    }
    const dStart = new Date(ev.startDate);
    const dEnd = new Date(ev.endDate || ev.startDate);

    // Past event check (should not be in output)
    if (dEnd < TODAY && dStart < TODAY) {
      warnings.push(`- **Past Event Included:** "${ev.title}" (${ev.club}) dated ${ev.startDate} is in the past.`);
    }

    // Suspicious future date (> 2 years)
    if (dStart > TWO_YEARS_AHEAD) {
      warnings.push(`- **Suspicious Distant Date:** "${ev.title}" (${ev.club}) is dated ${ev.startDate} (> 2 years in the future). Check year resolution.`);
    }

    // Empty or too short title
    if (!ev.title || ev.title.trim().length < 3) {
      warnings.push(`- **Empty / Short Title:** Event for club ${ev.club} on ${ev.startDate} has invalid title "${ev.title}".`);
    }

    // Missing URL
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
      warnings.push(`- **📅 Stale Program Warning for ${club}:** Has ${clubEvents.length} events scheduled, but none in the next 45 days. The seasonal program may have concluded and a new schedule might be available on their site.`);
    }
  }

  // 6. Update Health Baseline ONLY for clubs with NO anomalies
  // If a club has an anomaly, its baseline is FROZEN at the pre-error healthy state!
  // This prevents an erroneous day from becoming the "new normal" on day 2.
  for (const club in linkConfig) {
    if (!clubsWithAnomalies.has(club) && newByClub[club] && newByClub[club].length > 0) {
      healthBaseline[club] = newByClub[club];
    }
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(healthBaseline, null, 2), 'utf-8');

  // Summary Table Generation
  const clubSummaryRows = Object.keys(linkConfig).map(club => {
    const evList = newByClub[club] || [];
    const count = evList.length;
    const earliest = evList.length > 0 ? evList[0].startDate : '-';
    const latest = evList.length > 0 ? evList[evList.length - 1].startDate : '-';
    const baseCount = (healthBaseline[club] || []).filter(e => new Date(e.endDate || e.startDate) >= TODAY).length;
    const statusIcon = clubsWithAnomalies.has(club) ? '⚠️ Alert' : '✅ Healthy';
    return `| ${club} | ${count} | ${baseCount} | ${statusIcon} | ${earliest} | ${latest} |`;
  });

  const summaryTable = [
    `| Club | Active Events | Healthy Baseline | Status | Next Event | Furthest Event |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: |`,
    ...clubSummaryRows
  ].join('\n');

  // Any critical anomalies or website update notifications trigger the issue & alert
  const hasAlerts = criticalAnomalies.length > 0 || notifications.length > 0;

  if (hasAlerts) {
    const reportBody = `### ⚠️ Data Parsing & Website Update Report\n\nAttention: @kostis-kounadis\n\nThe automated daily scraper encountered updates or anomalies during the latest run.\n\n${criticalAnomalies.length > 0 ? `### 🚨 Critical Alerts\n${criticalAnomalies.join('\n')}\n\n` : ''}${notifications.length > 0 ? `### 📢 Website Updates Detected\n${notifications.join('\n')}\n\n` : ''}${warnings.length > 0 ? `### ℹ️ Warnings\n${warnings.join('\n')}\n\n` : ''}### 📊 Club Overview\n${summaryTable}\n\n*Action required: Review updates, check calendar, and close this issue.*`;
    
    fs.writeFileSync(REPORT_FILE, reportBody, 'utf-8');
    console.log(`\n🚨 Anomalies or updates detected! Wrote alert report to ${REPORT_FILE}`);
  } else {
    if (fs.existsSync(REPORT_FILE)) fs.unlinkSync(REPORT_FILE);
    console.log('\n✅ All good! No anomalies or webpage changes detected.');
    if (warnings.length > 0) {
      console.log(`\nℹ️ Warnings (${warnings.length}):\n${warnings.join('\n')}`);
    }
    console.log(`\n📊 Club Overview:\n${summaryTable}`);
  }
}

detectAnomalies();
