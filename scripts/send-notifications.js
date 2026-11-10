import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEW_EVENTS_FILE = path.join(__dirname, '../src/data/events.json');
const OLD_EVENTS_FILE = path.join(__dirname, '../src/data/events_old.json');
const OLD_BASELINE_FILE = path.join(__dirname, '../src/data/health-baseline-old.json');
const STATUS_FILE = path.join(__dirname, '../src/data/status.json');
const ANOMALY_REPORT_FILE = path.join(__dirname, '../src/data/anomaly_report.md');

const SITE_URL = 'https://kostis-kounadis.github.io/Mount-Athens/';

// Current Athens date (YYYY-MM-DD)
const athensFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const TODAY_STR = athensFormatter.format(new Date());

function normalizeTitle(title = '') {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0370-\u03ff]/g, '');
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[notifications] Failed to parse ${path.basename(filePath)}:`, err.message);
    return fallback;
  }
}

/**
 * Determines which healthy clubs have genuinely added new upcoming events.
 * Strictly ignores anomalies, cancellations, parser recoveries, and minor title edits.
 */
function findClubsWithNewEvents() {
  // Never send public notifications if a critical anomaly report is active
  if (fs.existsSync(ANOMALY_REPORT_FILE)) {
    console.log('[notifications] Active anomaly_report.md detected. Skipping notifications to avoid conflict with self-healing pipeline.');
    return { clubs: [], newEvents: [] };
  }

  if (!fs.existsSync(NEW_EVENTS_FILE) || !fs.existsSync(OLD_EVENTS_FILE)) {
    console.log('[notifications] Missing events.json or events_old.json. Skipping notifications.');
    return { clubs: [], newEvents: [] };
  }

  const newEvents = loadJsonSafe(NEW_EVENTS_FILE, []);
  const oldEvents = loadJsonSafe(OLD_EVENTS_FILE, []);
  const oldBaseline = loadJsonSafe(OLD_BASELINE_FILE, {});
  const statusData = loadJsonSafe(STATUS_FILE, { logs: [] });

  // Identify clubs whose latest scrape succeeded cleanly
  const healthyClubs = new Set();
  for (const log of (statusData.logs || [])) {
    if (log.status === 'success' && log.club) {
      healthyClubs.add(log.club);
    }
  }

  // Combine oldEvents and oldBaseline into a single historical reference pool
  // so recovering from a temporary outage never looks like "brand-new" events.
  const baselineEvents = Object.values(oldBaseline).flat();
  const historicalPool = [...oldEvents, ...baselineEvents];

  const knownUrls = new Set();
  const knownClubDateTitles = new Set();
  const oldCountByClubDate = new Map();

  // Deduplicate historical events before counting per (club, startDate)
  const seenHistoricalKeys = new Set();
  for (const ev of historicalPool) {
    if (!ev || !ev.club || !ev.startDate) continue;
    if (ev.url) knownUrls.add(ev.url.trim());

    const normTitle = normalizeTitle(ev.title);
    const fullKey = `${ev.club}::${ev.startDate}::${normTitle}`;
    knownClubDateTitles.add(fullKey);

    const uniqueHistId = ev.url ? `${ev.club}::${ev.startDate}::${ev.url.trim()}` : fullKey;
    if (!seenHistoricalKeys.has(uniqueHistId)) {
      seenHistoricalKeys.add(uniqueHistId);
      const dateKey = `${ev.club}::${ev.startDate}`;
      oldCountByClubDate.set(dateKey, (oldCountByClubDate.get(dateKey) || 0) + 1);
    }
  }

  // Group current events by (club, startDate) to protect against minor title edits
  const newEventsByClubDate = new Map();
  for (const ev of newEvents) {
    if (!ev || !ev.club || !ev.startDate) continue;
    const endOrStart = ev.endDate || ev.startDate;
    if (endOrStart < TODAY_STR) continue; // Ignore past events
    if (!healthyClubs.has(ev.club)) continue; // Ignore clubs with scrape warnings/errors

    const dateKey = `${ev.club}::${ev.startDate}`;
    if (!newEventsByClubDate.has(dateKey)) {
      newEventsByClubDate.set(dateKey, []);
    }
    newEventsByClubDate.get(dateKey).push(ev);
  }

  const detectedNewEvents = [];
  const clubsWithNew = new Set();

  for (const [dateKey, evList] of newEventsByClubDate.entries()) {
    const previousCount = oldCountByClubDate.get(dateKey) || 0;
    // Find events on this date that did not match a known URL or normalized title
    const unmatchedOnDate = evList.filter(ev => {
      const urlKnown = ev.url && knownUrls.has(ev.url.trim());
      const titleKnown = knownClubDateTitles.has(`${ev.club}::${ev.startDate}::${normalizeTitle(ev.title)}`);
      return !urlKnown && !titleKnown;
    });

    // Only count as genuinely new if the club actually has more events on this date than before
    // (prevents a simple title typo fix on an existing date from firing a notification)
    if (unmatchedOnDate.length > 0 && evList.length > previousCount) {
      const addedCount = Math.min(unmatchedOnDate.length, evList.length - previousCount);
      for (let i = 0; i < addedCount; i++) {
        detectedNewEvents.push(unmatchedOnDate[i]);
        clubsWithNew.add(unmatchedOnDate[i].club);
      }
    }
  }

  return {
    clubs: Array.from(clubsWithNew),
    newEvents: detectedNewEvents
  };
}

function buildMessages(clubs) {
  const isSingle = clubs.length === 1;
  const clubsText = clubs.join(', ');

  const telegramHtml = isSingle
    ? `Προστέθηκαν νέες εξορμήσεις από τον σύλλογο <b>${escapeHtml(clubsText)}</b>.\n\nΔείτε το ανανεωμένο πρόγραμμα στο <a href="${SITE_URL}">Ορειβατικό Ημερολόγιο</a>.`
    : `Προστέθηκαν νέες εξορμήσεις από τους συλλόγους <b>${escapeHtml(clubsText)}</b>.\n\nΔείτε το ανανεωμένο πρόγραμμα στο <a href="${SITE_URL}">Ορειβατικό Ημερολόγιο</a>.`;

  const emailSubject = isSingle
    ? `Νέες εξορμήσεις (${clubsText}) — Ορειβατικό Ημερολόγιο`
    : `Νέες εξορμήσεις (${clubsText}) — Ορειβατικό Ημερολόγιο`;

  const emailBody = isSingle
    ? `Προστέθηκαν νέες εξορμήσεις από τον σύλλογο **${clubsText}**.\n\nΔείτε το ανανεωμένο πρόγραμμα στο [Ορειβατικό Ημερολόγιο](${SITE_URL}).`
    : `Προστέθηκαν νέες εξορμήσεις από τους συλλόγους **${clubsText}**.\n\nΔείτε το ανανεωμένο πρόγραμμα στο [Ορειβατικό Ημερολόγιο](${SITE_URL}).`;

  return { telegramHtml, emailSubject, emailBody };
}

async function sendTelegramMessage(botToken, chatId, htmlText) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
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

async function sendButtondownEmail(apiKey, subject, body) {
  const res = await fetch('https://api.buttondown.com/v1/emails', {
    method: 'POST',
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

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isTestAdmin = args.includes('--test-admin');
  const simArg = args.find(a => a.startsWith('--simulate='));

  let clubs = [];
  let newEvents = [];

  if (simArg) {
    clubs = simArg
      .replace('--simulate=', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    console.log(`[notifications] Simulated clubs with new events: ${clubs.join(', ')}`);
  } else if (isTestAdmin) {
    clubs = ['ΕΟΣ Αθηνών'];
    console.log('[notifications] Running --test-admin mode with sample club: ΕΟΣ Αθηνών');
  } else {
    const result = findClubsWithNewEvents();
    clubs = result.clubs;
    newEvents = result.newEvents;
  }

  if (clubs.length === 0) {
    console.log('[notifications] No new upcoming events detected across healthy clubs. Nothing to send.');
    return;
  }

  const { telegramHtml, emailSubject, emailBody } = buildMessages(clubs);

  console.log(`\n[notifications] Clubs with new events (${clubs.length}): ${clubs.join(', ')}`);
  if (newEvents.length > 0) {
    console.log(`[notifications] New events count: ${newEvents.length}`);
    for (const ev of newEvents) {
      console.log(`  - [${ev.club}] ${ev.startDate}: ${ev.title}`);
    }
  }

  if (isDryRun) {
    console.log('\n--- [DRY RUN] Telegram HTML Payload ---');
    console.log(telegramHtml);
    console.log('\n--- [DRY RUN] Buttondown Email Payload ---');
    console.log(`Subject: ${emailSubject}`);
    console.log(emailBody);
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const buttondownKey = process.env.BUTTONDOWN_API_KEY;

  // 1. Admin Telegram Notification
  if (botToken && adminChatId) {
    try {
      await sendTelegramMessage(botToken, adminChatId, telegramHtml);
      console.log(`[notifications] Sent Telegram notification to Admin (${adminChatId}).`);
    } catch (err) {
      console.error('[notifications] Failed to send Admin Telegram message:', err.message);
    }
  } else {
    console.log('[notifications] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set; skipping admin alert.');
  }

  if (isTestAdmin) {
    console.log('[notifications] --test-admin complete (skipped public channel and email broadcast).');
    return;
  }

  // 2. Public Telegram Channel Broadcast
  if (botToken && channelId) {
    try {
      await sendTelegramMessage(botToken, channelId, telegramHtml);
      console.log(`[notifications] Broadcast Telegram notification to Channel (${channelId}).`);
    } catch (err) {
      console.error('[notifications] Failed to broadcast to Telegram Channel:', err.message);
    }
  } else {
    console.log('[notifications] TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set; skipping channel broadcast.');
  }

  // 3. Buttondown Email Subscribers Broadcast
  if (buttondownKey) {
    try {
      await sendButtondownEmail(buttondownKey, emailSubject, emailBody);
      console.log('[notifications] Triggered Buttondown email broadcast.');
    } catch (err) {
      console.error('[notifications] Failed to trigger Buttondown email broadcast:', err.message);
    }
  } else {
    console.log('[notifications] BUTTONDOWN_API_KEY not set; skipping email broadcast.');
  }
}

main().catch(err => {
  console.error('[notifications] Unexpected error:', err);
  process.exit(0); // Never fail CI build because of notification error
});
