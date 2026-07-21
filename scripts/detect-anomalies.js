import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLD_FILE = path.join(__dirname, '../src/data/events_old.json');
const NEW_FILE = path.join(__dirname, '../src/data/events.json');
const REPORT_FILE = path.join(__dirname, '../src/data/anomaly_report.md');

// Only care about events that haven't naturally expired based on local system time
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function detectAnomalies() {
  if (!fs.existsSync(OLD_FILE) || !fs.existsSync(NEW_FILE)) {
    console.log('Skipping anomaly detection: old or new events file missing.');
    return;
  }

  const oldEvents = JSON.parse(fs.readFileSync(OLD_FILE, 'utf-8'));
  const newEvents = JSON.parse(fs.readFileSync(NEW_FILE, 'utf-8'));

  const anomalies = [];

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

  // 1. Check for missing clubs or drastic drops
  for (const club in oldByClub) {
    // Filter out events that naturally expired between yesterday and today
    const upcomingOld = oldByClub[club].filter(e => new Date(e.startDate) >= TODAY);
    const newClubEvents = newByClub[club] || [];

    if (upcomingOld.length > 0 && newClubEvents.length === 0) {
      anomalies.push(`- **Complete Data Loss for ${club}:** Had ${upcomingOld.length} upcoming events yesterday, but 0 today!`);
    } else if (upcomingOld.length >= 4 && newClubEvents.length < (upcomingOld.length / 2)) {
      anomalies.push(`- **Drastic Drop for ${club}:** Upcoming events dropped from ${upcomingOld.length} yesterday to ${newClubEvents.length} today.`);
    }
  }

  // 2. Check for overall drastic drop
  const totalUpcomingOld = oldEvents.filter(e => new Date(e.startDate) >= TODAY).length;
  const totalNew = newEvents.length;

  if (totalUpcomingOld >= 10 && totalNew < (totalUpcomingOld / 2)) {
    anomalies.push(`- **Massive Overall Data Loss:** Total upcoming events dropped from ${totalUpcomingOld} to ${totalNew} overnight!`);
  }

  // Write report if anomalies exist
  if (anomalies.length > 0) {
    const reportBody = `### ⚠️ Data Parsing Anomalies Detected\n\nThe automated daily scraper encountered unexpected data drops. Please manually check the parsers.\n\n${anomalies.join('\n')}\n\n*Action required: Fix the parsers or website structure, then close this issue to receive future alerts.*`;
    fs.writeFileSync(REPORT_FILE, reportBody, 'utf-8');
    console.log(`Anomalies detected! Wrote report to ${REPORT_FILE}`);
  } else {
    if (fs.existsSync(REPORT_FILE)) fs.unlinkSync(REPORT_FILE);
    console.log('All good! No anomalies detected.');
  }
}

detectAnomalies();
