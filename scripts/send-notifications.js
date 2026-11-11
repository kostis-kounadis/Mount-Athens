import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEW_EVENTS_FILE = path.join(__dirname, '../src/data/events.json');
const OLD_EVENTS_FILE = path.join(__dirname, '../src/data/events_old.json');
const OLD_BASELINE_FILE = path.join(__dirname, '../src/data/health-baseline-old.json');
const STATUS_FILE = path.join(__dirname, '../src/data/status.json');
const ANOMALY_REPORT_FILE = path.join(__dirname, '../src/data/anomaly_report.md');
const LOCAL_SUMMARY_FILE = path.join(__dirname, '../_input/last_sync_summary.md');

const SITE_URL = 'https://kostis-kounadis.github.io/Mount-Athens/';

// Current Athens date (YYYY-MM-DD)
const athensFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Athens',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const TODAY_STR = athensFormatter.format(new Date());
const CURRENT_YEAR = TODAY_STR.substring(0, 4);

function normalizeTitle(title = '') {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0370-\u03ff]/g, '');
}

function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getEventAnchor(ev) {
  const club = (ev.club || '').trim();
  const startDate = (ev.startDate || '').trim();
  const title = (ev.title || '').trim();
  const hash = crypto.createHash('sha256').update(`${club}::${startDate}::${title}`).digest('hex').slice(0, 8);
  return `ev-${startDate}-${hash}`;
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
 * Format event date string clearly:
 * If the event is in a future year (e.g. 2027), appends the year if not already present.
 */
function formatEventDate(ev) {
  const startYear = ev.startDate ? ev.startDate.substring(0, 4) : '';
  const isFutureYear = startYear && startYear !== CURRENT_YEAR;

  let dateStr = ev.displayDate || ev.startDate || '';
  if (isFutureYear && !dateStr.includes(startYear) && !dateStr.includes(startYear.slice(2))) {
    dateStr += `/${startYear}`;
  }
  return dateStr;
}

/**
 * Compares current events against historical reference pool to find additions & removals.
 * Strictly ignores anomalies, recoveries, and minor title edits on existing dates.
 */
function diffEvents() {
  const statusData = loadJsonSafe(STATUS_FILE, { logs: [] });

  if (fs.existsSync(ANOMALY_REPORT_FILE)) {
    console.log('[notifications] Active anomaly_report.md detected. Skipping public broadcast to avoid conflict with self-healing pipeline.');
    return { clubs: [], addedEvents: [], removedEvents: [], healthyClubsCount: 0, statusLogs: statusData.logs || [] };
  }

  if (!fs.existsSync(NEW_EVENTS_FILE) || !fs.existsSync(OLD_EVENTS_FILE)) {
    console.log('[notifications] Missing events.json or events_old.json. Skipping notifications.');
    return { clubs: [], addedEvents: [], removedEvents: [], healthyClubsCount: 0, statusLogs: statusData.logs || [] };
  }

  const newEvents = loadJsonSafe(NEW_EVENTS_FILE, []);
  const oldEvents = loadJsonSafe(OLD_EVENTS_FILE, []);
  const oldBaseline = loadJsonSafe(OLD_BASELINE_FILE, {});

  const healthyClubs = new Set();
  for (const log of (statusData.logs || [])) {
    if (log.status === 'success' && log.club) {
      healthyClubs.add(log.club);
    }
  }

  // Combine oldEvents and oldBaseline into a single historical reference pool
  const baselineEvents = Object.values(oldBaseline).flat();
  const historicalPool = [...oldEvents, ...baselineEvents];

  const knownUrls = new Set();
  const knownClubDateTitles = new Set();
  const oldCountByClubDate = new Map();

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

  // Group current upcoming events by (club, startDate)
  const newEventsByClubDate = new Map();
  const currentUpcomingUrls = new Set();
  const currentUpcomingKeys = new Set();

  for (const ev of newEvents) {
    if (!ev || !ev.club || !ev.startDate) continue;
    const endOrStart = ev.endDate || ev.startDate;
    if (endOrStart < TODAY_STR) continue;

    if (ev.url) currentUpcomingUrls.add(ev.url.trim());
    currentUpcomingKeys.add(`${ev.club}::${ev.startDate}::${normalizeTitle(ev.title)}`);

    if (!healthyClubs.has(ev.club)) continue;

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
    const unmatchedOnDate = evList.filter(ev => {
      const urlKnown = ev.url && knownUrls.has(ev.url.trim());
      const titleKnown = knownClubDateTitles.has(`${ev.club}::${ev.startDate}::${normalizeTitle(ev.title)}`);
      return !urlKnown && !titleKnown;
    });

    if (unmatchedOnDate.length > 0 && evList.length > previousCount) {
      const addedCount = Math.min(unmatchedOnDate.length, evList.length - previousCount);
      for (let i = 0; i < addedCount; i++) {
        detectedNewEvents.push(unmatchedOnDate[i]);
        clubsWithNew.add(unmatchedOnDate[i].club);
      }
    }
  }

  // Detect removed future events from healthy clubs
  const detectedRemovedEvents = [];
  for (const ev of oldEvents) {
    if (!ev || !ev.club || !ev.startDate) continue;
    const endOrStart = ev.endDate || ev.startDate;
    if (endOrStart < TODAY_STR) continue;
    if (!healthyClubs.has(ev.club)) continue;

    const urlMatches = ev.url && currentUpcomingUrls.has(ev.url.trim());
    const keyMatches = currentUpcomingKeys.has(`${ev.club}::${ev.startDate}::${normalizeTitle(ev.title)}`);
    if (!urlMatches && !keyMatches) {
      detectedRemovedEvents.push(ev);
    }
  }

  return {
    clubs: Array.from(clubsWithNew),
    addedEvents: detectedNewEvents,
    removedEvents: detectedRemovedEvents,
    healthyClubsCount: healthyClubs.size,
    statusLogs: statusData.logs || []
  };
}

/**
 * Build rich, compact notification messages with bullet list of added events.
 */
function buildMessages(clubs, events) {
  const isSingle = clubs.length === 1;
  const clubsText = clubs.join(', ');

  const headerTg = isSingle
    ? `Προστέθηκαν νέες εξορμήσεις από τον σύλλογο <b>${escapeHtml(clubsText)}</b>:`
    : `Προστέθηκαν νέες εξορμήσεις από τους συλλόγους <b>${escapeHtml(clubsText)}</b>:`;

  const headerEmail = isSingle
    ? `Προστέθηκαν νέες εξορμήσεις από τον σύλλογο **${clubsText}**:`
    : `Προστέθηκαν νέες εξορμήσεις από τους συλλόγους **${clubsText}**:`;

  const bulletsTg = [];
  const bulletsEmail = [];

  for (const ev of events) {
    const dateStr = formatEventDate(ev);
    const diffTag = ev.difficulty ? ` (Β.Δ. ${ev.difficulty})` : '';
    const clubTag = isSingle ? '' : `[${ev.club}] `;
    const anchor = getEventAnchor(ev);
    const eventUrl = `${SITE_URL}#${anchor}`;

    // Telegram HTML bullet
    const tgPrefix = isSingle ? `• <b>${escapeHtml(dateStr)}</b>: ` : `• <b>[${escapeHtml(ev.club)}] ${escapeHtml(dateStr)}</b>: `;
    bulletsTg.push(`${tgPrefix}<a href="${escapeHtml(eventUrl)}">${escapeHtml(ev.title)}</a>${escapeHtml(diffTag)}`);

    // Email Markdown bullet
    const emPrefix = isSingle ? `* **${dateStr}**: ` : `* **[${ev.club}] ${dateStr}**: `;
    bulletsEmail.push(`${emPrefix}[${ev.title}](${eventUrl})${diffTag}`);
  }

  const footerTg = `\nΔείτε το ανανεωμένο πρόγραμμα στο <a href="${SITE_URL}">Ορειβατικό Ημερολόγιο</a>.`;
  const footerEmail = `\nΔείτε το ανανεωμένο πρόγραμμα στο [Ορειβατικό Ημερολόγιο](${SITE_URL}).`;

  const fullTelegramHtml = `${headerTg}\n\n${bulletsTg.join('\n')}\n${footerTg}`;
  const fullEmailBody = `${headerEmail}\n\n${bulletsEmail.join('\n')}\n${footerEmail}`;

  const emailSubject = isSingle
    ? `Νέες εξορμήσεις: ${clubsText} — Ορειβατικό Ημερολόγιο`
    : `Νέες εξορμήσεις: ${clubsText} — Ορειβατικό Ημερολόγιο`;

  // Telegram 4,096-character limit chunking safety
  const telegramMessages = [];
  if (fullTelegramHtml.length <= 4000) {
    telegramMessages.push(fullTelegramHtml);
  } else {
    // Split bullets cleanly into 2 parts
    const half = Math.ceil(bulletsTg.length / 2);
    const part1Bullets = bulletsTg.slice(0, half).join('\n');
    const part2Bullets = bulletsTg.slice(half).join('\n');
    telegramMessages.push(`${headerTg} (Μέρος 1)\n\n${part1Bullets}`);
    telegramMessages.push(`<b>Νέες εξορμήσεις (Μέρος 2):</b>\n\n${part2Bullets}\n${footerTg}`);
  }

  return {
    telegramHtml: fullTelegramHtml,
    telegramMessages,
    emailSubject,
    emailBody: fullEmailBody
  };
}

/**
 * Generate rich GitHub Actions Step Summary and local changelog file
 */
function recordAdminChangeLog(addedEvents, removedEvents, healthyClubsCount, statusLogs) {
  const lines = [];
  lines.push(`### 🏔️ Mount Athens — Excursion Sync Summary`);
  lines.push(`**Date:** ${TODAY_STR} | **Healthy Clubs:** ${healthyClubsCount}/8\n`);

  if (addedEvents.length === 0 && removedEvents.length === 0) {
    lines.push(`*No excursions were added or removed in this run.*\n`);
  }

  if (addedEvents.length > 0) {
    lines.push(`#### ➕ Newly Added Excursions (${addedEvents.length})`);
    lines.push(`| Date | Club | Title | Difficulty | Site Link | Club Booking |`);
    lines.push(`| :--- | :--- | :--- | :---: | :--- | :--- |`);
    for (const ev of addedEvents) {
      const dateStr = formatEventDate(ev);
      const diff = ev.difficulty || '-';
      const siteLink = `[Site Anchor](${SITE_URL}#${getEventAnchor(ev)})`;
      const clubLink = ev.url ? `[Club Booking](${ev.url})` : '-';
      lines.push(`| ${dateStr} | ${ev.club} | ${ev.title} | ${diff} | ${siteLink} | ${clubLink} |`);
    }
    lines.push('');
  }

  if (removedEvents.length > 0) {
    lines.push(`#### ➖ Removed / Cancelled Excursions (${removedEvents.length})`);
    lines.push(`| Date | Club | Title | Difficulty |`);
    lines.push(`| :--- | :--- | :--- | :---: |`);
    for (const ev of removedEvents) {
      const dateStr = formatEventDate(ev);
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
      const statusIcon = log.status === 'success' ? '✅ OK' : '⚠️ Warning';
      lines.push(`| ${log.club} | ${statusIcon} | ${log.details || '-'} |`);
    }
    lines.push('');
  }

  const markdownContent = lines.join('\n');

  // 1. Write to GitHub Actions Step Summary if available
  const summaryEnv = process.env.GITHUB_STEP_SUMMARY;
  if (summaryEnv) {
    try {
      fs.appendFileSync(summaryEnv, markdownContent + '\n', 'utf-8');
      console.log('[notifications] Appended change log to $GITHUB_STEP_SUMMARY.');
    } catch (err) {
      console.warn('[notifications] Failed to write to GITHUB_STEP_SUMMARY:', err.message);
    }
  }

  // 2. Write to local summary file (archived by CI artifact step)
  try {
    const inputDir = path.dirname(LOCAL_SUMMARY_FILE);
    if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(LOCAL_SUMMARY_FILE, markdownContent, 'utf-8');
  } catch (err) {
    // Ignore non-critical local file write errors
  }
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
  let addedEvents = [];
  let removedEvents = [];
  let healthyClubsCount = 8;
  let statusLogs = [];

  if (simArg) {
    clubs = simArg
      .replace('--simulate=', '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // Mock realistic sample events for simulation
    addedEvents = clubs.flatMap((club, idx) => [
      {
        startDate: '2027-03-13',
        endDate: '2027-03-15',
        displayDate: '13-15/3',
        title: idx === 0 ? 'Ορειβατικό σκι στον Γράμμο, Πληκάτι–Τσούκα Πετσίκ–Γκέσος' : `Ανάβαση σε κορυφή ${idx + 1}`,
        club,
        url: 'https://eosacharnon.xmiddleware.com/el/booking/cmwau20z2018ft401m13rtepb',
        difficulty: 'Δ'
      },
      {
        startDate: '2026-12-20',
        endDate: '2026-12-21',
        displayDate: '20-21/12',
        title: `Χειμερινή διάσχιση Βαρδουσίων ${idx + 1}`,
        club,
        url: 'https://kostis-kounadis.github.io/Mount-Athens/',
        difficulty: '2+'
      }
    ]);
    console.log(`[notifications] Simulated ${addedEvents.length} events across clubs: ${clubs.join(', ')}`);
  } else if (isTestAdmin) {
    clubs = ['ΕΟΣ Αχαρνών'];
    addedEvents = [
      {
        startDate: '2027-03-13',
        endDate: '2027-03-15',
        displayDate: '13-15/3',
        title: 'Ορειβατικό σκι στον Γράμμο, Πληκάτι–Τσούκα Πετσίκ–Γκέσος',
        club: 'ΕΟΣ Αχαρνών',
        url: 'https://eosacharnon.xmiddleware.com/el/booking/cmwau20z2018ft401m13rtepb',
        difficulty: 'Δ'
      }
    ];
    console.log('[notifications] Running --test-admin mode with sample event from ΕΟΣ Αχαρνών');
  } else {
    const diff = diffEvents();
    clubs = diff.clubs;
    addedEvents = diff.addedEvents;
    removedEvents = diff.removedEvents;
    healthyClubsCount = diff.healthyClubsCount;
    statusLogs = diff.statusLogs;
  }

  // Record Admin Step Summary regardless of whether notifications fire
  recordAdminChangeLog(addedEvents, removedEvents, healthyClubsCount, statusLogs);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const buttondownKey = process.env.BUTTONDOWN_API_KEY;

  // Send Scraper Warning / Anomaly Alert directly to Admin Chat ID
  const degradedClubs = statusLogs.filter(l => l.status === 'warning' || l.status === 'error');
  const hasAnomalyReport = fs.existsSync(ANOMALY_REPORT_FILE);

  if ((hasAnomalyReport || degradedClubs.length > 0) && botToken && adminChatId) {
    let warningBullets = '';
    if (hasAnomalyReport) {
      try {
        const reportContent = fs.readFileSync(ANOMALY_REPORT_FILE, 'utf-8');
        const alertsSection = reportContent.split('### 🚨 Critical Alerts')[1]?.split('###')[0]?.trim();
        warningBullets = alertsSection ? escapeHtml(alertsSection) : '';
      } catch (e) {}
    }
    if (!warningBullets && degradedClubs.length > 0) {
      warningBullets = degradedClubs.map(l => `• <b>${escapeHtml(l.club)}:</b> ${escapeHtml(l.details)}`).join('\n');
    }

    const adminAlertText = `⚠️ <b>[Mount Athens] Προειδοποίηση Scraper / Anomaly Alert</b>\n\n${warningBullets}\n\n<i>Δημιουργήθηκε σχετικό GitHub Issue στο αποθετήριο με οδηγίες αυτόματης επίλυσης.</i>`;
    if (isDryRun) {
      console.log('\n--- [DRY RUN] Admin Scraper Anomaly Alert ---');
      console.log(adminAlertText);
    } else {
      try {
        await sendTelegramMessage(botToken, adminChatId, adminAlertText);
        console.log(`[notifications] Sent scraper anomaly/fallback alert to Admin (${adminChatId}).`);
      } catch (err) {
        console.error('[notifications] Failed to send scraper alert to Admin:', err.message);
      }
    }
  }

  if (clubs.length === 0 || addedEvents.length === 0) {
    console.log('[notifications] No new upcoming events detected across healthy clubs. Nothing to send.');
    return;
  }

  const { telegramHtml, telegramMessages, emailSubject, emailBody } = buildMessages(clubs, addedEvents);

  console.log(`\n[notifications] Clubs with new events (${clubs.length}): ${clubs.join(', ')}`);
  console.log(`[notifications] New events count: ${addedEvents.length}`);
  for (const ev of addedEvents) {
    console.log(`  - [${ev.club}] ${formatEventDate(ev)}: ${ev.title}${ev.difficulty ? ` (${ev.difficulty})` : ''}`);
  }

  if (isDryRun) {
    console.log('\n--- [DRY RUN] Telegram HTML Message(s) ---');
    for (const msg of telegramMessages) {
      console.log(msg);
      console.log('-------------------------------------------');
    }
    console.log('\n--- [DRY RUN] Buttondown Email Payload ---');
    console.log(`Subject: ${emailSubject}`);
    console.log(emailBody);
    return;
  }

  // 1. Admin Telegram Notification (with 1-line admin metadata footer)
  if (botToken && adminChatId) {
    try {
      const adminFooter = `\n\n<i>ℹ️ [Admin: +${addedEvents.length} added, -${removedEvents.length} removed | ${healthyClubsCount}/8 clubs healthy]</i>`;
      const adminMessage = `${telegramHtml}${adminFooter}`;
      await sendTelegramMessage(botToken, adminChatId, adminMessage);
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
      for (const msg of telegramMessages) {
        await sendTelegramMessage(botToken, channelId, msg);
      }
      console.log(`[notifications] Broadcast Telegram notification to Channel (${channelId}) in ${telegramMessages.length} message(s).`);
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
