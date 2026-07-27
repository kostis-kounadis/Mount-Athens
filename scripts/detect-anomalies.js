import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLD_FILE = path.join(__dirname, '../src/data/events_old.json');
const NEW_FILE = path.join(__dirname, '../src/data/events.json');
const STATUS_FILE = path.join(__dirname, '../src/data/status.json');
const LINK_CONFIG_FILE = path.join(__dirname, '../_input/link-config.json');
const CURRENT_HASHES_FILE = path.join(__dirname, '../_input/content-hashes.json');
const OLD_HASHES_FILE = path.join(__dirname, '../_input/content-hashes-old.json');
const REPORT_FILE = path.join(__dirname, '../src/data/anomaly_report.md');

// Only care about events that haven't naturally expired based on local system time
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function detectAnomalies() {
  if (!fs.existsSync(NEW_FILE)) {
    console.log('Skipping anomaly detection: events file missing.');
    return;
  }

  const oldEvents = fs.existsSync(OLD_FILE) ? JSON.parse(fs.readFileSync(OLD_FILE, 'utf-8')) : [];
  const newEvents = JSON.parse(fs.readFileSync(NEW_FILE, 'utf-8'));
  const linkConfig = fs.existsSync(LINK_CONFIG_FILE) ? JSON.parse(fs.readFileSync(LINK_CONFIG_FILE, 'utf-8')) : {};
  const statusData = fs.existsSync(STATUS_FILE) ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8')) : { logs: [] };
  const currentHashes = fs.existsSync(CURRENT_HASHES_FILE) ? JSON.parse(fs.readFileSync(CURRENT_HASHES_FILE, 'utf-8')) : {};
  const oldHashes = fs.existsSync(OLD_HASHES_FILE) ? JSON.parse(fs.readFileSync(OLD_HASHES_FILE, 'utf-8')) : {};

  const anomalies = [];

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

  // Group by club
  const oldByClub = {};
  for (const ev of oldEvents) {
    if (!oldByClub[ev.club]) oldByClub[ev.club] = [];
    oldByClub[ev.club].push(ev);
  }

  const newByClub = {};
  for (const ev of newEvents) {
    if (!newByClub[ev.club]) newByClub[ev.club] = [];
    newByClub[ev.club].push(ev);
  }

  // 1. Check configured active clubs for zero parsed events in status.json
  for (const club in linkConfig) {
    const clubInfo = clubStatusMap[club] || { parsedCount: 0, status: 'unknown' };
    
    if (clubInfo.parsedCount === 0 || clubInfo.status === 'error') {
      // Check if website content changed overnight
      const clubUrls = linkConfig[club] || [];
      let contentChanged = false;
      for (const url of clubUrls) {
        if (oldHashes[url] && currentHashes[url] && oldHashes[url] !== currentHashes[url]) {
          contentChanged = true;
          break;
        }
      }

      if (contentChanged) {
        anomalies.push(`- **🚨 Website Updated But Parser Failed for ${club}:** The club updated its website content overnight, but the parser returned 0 events!`);
      } else {
        anomalies.push(`- **⚠️ Complete Data Loss for ${club}:** Parser returned 0 events for configured club.`);
      }
    }
  }

  // 2. Check for drastic drops from yesterday
  for (const club in oldByClub) {
    // Skip if already flagged under absolute zero check
    if (anomalies.some(a => a.includes(club))) continue;

    const upcomingOld = oldByClub[club].filter(e => new Date(e.startDate) >= TODAY);
    const newClubEvents = newByClub[club] || [];

    if (upcomingOld.length > 0 && newClubEvents.length === 0) {
      anomalies.push(`- **Complete Data Loss for ${club}:** Had ${upcomingOld.length} upcoming events yesterday, but 0 today!`);
    } else if (upcomingOld.length >= 4 && newClubEvents.length < (upcomingOld.length / 2)) {
      anomalies.push(`- **Drastic Drop for ${club}:** Upcoming events dropped from ${upcomingOld.length} yesterday to ${newClubEvents.length} today.`);
    }
  }

  // 3. Check for overall drastic drop
  if (oldEvents.length > 0) {
    const totalUpcomingOld = oldEvents.filter(e => new Date(e.startDate) >= TODAY).length;
    const totalNew = newEvents.length;

    if (totalUpcomingOld >= 10 && totalNew < (totalUpcomingOld / 2)) {
      anomalies.push(`- **Massive Overall Data Loss:** Total upcoming events dropped from ${totalUpcomingOld} to ${totalNew} overnight!`);
    }
  }

  // Write report if anomalies exist
  if (anomalies.length > 0) {
    const reportBody = `### ⚠️ Data Parsing Anomalies Detected\n\nThe automated daily scraper encountered unexpected data issues. Please manually check the parsers.\n\n${anomalies.join('\n')}\n\n*Action required: Fix the parsers or website structure, then close this issue to receive future alerts.*`;
    fs.writeFileSync(REPORT_FILE, reportBody, 'utf-8');
    console.log(`Anomalies detected! Wrote report to ${REPORT_FILE}`);
  } else {
    if (fs.existsSync(REPORT_FILE)) fs.unlinkSync(REPORT_FILE);
    console.log('All good! No anomalies detected.');
  }
}

detectAnomalies();
