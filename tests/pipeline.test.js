import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isDedicatedEventUrl,
  normalizeUrl,
  getEventAnchor,
  chunkTelegramBlocks,
  chunkHtmlText,
  isValidCalendarDate
} from '../scripts/lib/event-utils.js';
import { cleanInputDir, mergeContentHashes } from '../scripts/fetch-raw.js';
import { probeFailedFetches } from '../scripts/debug-fetch.js';
import {
  deduplicateEvents,
  sortEventsDeterministically,
  resolveClubEventsWithFallback
} from '../scripts/parse-events.js';
import { detectAnomalies } from '../scripts/detect-anomalies.js';
import {
  classifyEventChange,
  diffEventsWithLedger,
  buildSubscriberMessages,
  buildAdminHealthAlert,
  createLedgerEntry,
  runNotifications
} from '../scripts/send-notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function makeTempDir(prefix = 'mount-athens-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('event-utils: isDedicatedEventUrl distinguishes dedicated URLs from fragment and index URLs', () => {
  assert.equal(isDedicatedEventUrl('https://eposfilis.gr/event/10-1-2027-notios-ymittos/'), true);
  assert.equal(isDedicatedEventUrl('https://eosh.gr/expeditions/hymettus-ilioupoli'), true);
  assert.equal(isDedicatedEventUrl('https://eosacharnon.xmiddleware.com/el/booking/abc123'), true);
  assert.equal(isDedicatedEventUrl('https://www.foni.org.gr/06-dekemvriou-2026-kamari/'), true);
  assert.equal(isDedicatedEventUrl('https://aos.gr/29-noemvriou-2026-dryodasos/'), true);

  // Fragment & generic club index URLs must be false
  assert.equal(isDedicatedEventUrl('https://fop.gr/#:~:text=%CE%93%CE%9A%CE%99%CE%A9%CE%9D%CE%91'), false);
  assert.equal(isDedicatedEventUrl('https://www.eosathinon.gr/anavaseis/programma/#12-26:~:text=TEST'), false);
  assert.equal(isDedicatedEventUrl('https://poa.gr/index.php/programma/#:~:text=TEST'), false);
  assert.equal(isDedicatedEventUrl('https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/'), false);
  assert.equal(isDedicatedEventUrl('https://aos.gr/programma-exormiseon-ianouarios-2026-septemvrios-2026/'), false);
  assert.equal(isDedicatedEventUrl('https://fop.gr/'), false);
  assert.equal(isDedicatedEventUrl(''), false);
});

test('event-utils: getEventAnchor matches Astro frontend SHA-256 format', () => {
  const anchor = getEventAnchor({
    club: 'ΕΠΟΣ Φυλής',
    startDate: '2027-01-10',
    title: 'Νότιος Υμηττός : Τρύπια Σπηλιά – Διάσελο Σταυρού – Ρέμα Πρινάρι – βάραθρο Θρακιάς Σταυρού'
  });
  assert.equal(anchor, 'ev-2027-01-10-9f1d1eaa');
});

test('event-utils: chunkTelegramBlocks & chunkHtmlText stay strictly under 3900 chars for 60+ events', () => {
  const blocks = Array.from({ length: 65 }, (_, i) =>
    `• <b>${(i % 28) + 1}/1/2027</b>: <a href="https://kostis-kounadis.github.io/Mount-Athens/#ev-2027-01-01-12345678">Εξόρμηση σε κορυφή ${i + 1} με αρκετά μεγάλη περιγραφή διαδρομής και λεπτομέρειες</a> (Β.Δ. 2+)`
  );
  const chunks = chunkTelegramBlocks('<b>Ενημερώσεις εξορμήσεων:</b>', blocks, 'Footer', 3900);
  assert.ok(chunks.length >= 3, `Expected >=3 chunks, got ${chunks.length}`);
  for (const ch of chunks) {
    assert.ok(ch.length <= 3900, `Chunk exceeded 3900 chars: ${ch.length}`);
  }
  assert.ok(chunks[chunks.length - 1].includes('Footer'));

  const longAdmin = Array.from({ length: 80 }, (_, i) => `• <b>Club ${i}</b>: Detailed error message number ${i} with description text`).join('\n');
  const adminChunks = chunkHtmlText(longAdmin, 3900);
  assert.ok(adminChunks.length >= 2);
  for (const ch of adminChunks) {
    assert.ok(ch.length <= 3900);
  }
});

test('fetch-raw: cleanInputDir removes stale files and mergeContentHashes preserves failed URL hashes', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'stale_old.html'), 'old html');
    fs.writeFileSync(path.join(dir, 'stale_old.txt'), 'old txt');
    fs.writeFileSync(path.join(dir, 'fetch-status.json'), '{}');
    fs.writeFileSync(path.join(dir, 'keep-note.md'), 'keep');

    const removed = cleanInputDir(dir);
    assert.equal(removed, 3);
    assert.equal(fs.existsSync(path.join(dir, 'stale_old.html')), false);
    assert.equal(fs.existsSync(path.join(dir, 'stale_old.txt')), false);
    assert.equal(fs.existsSync(path.join(dir, 'keep-note.md')), true);

    const prevHashes = {
      'https://poa.gr/index.php/programma/': 'hash-poa-old',
      'https://eposfilis.gr/wp-json/tribe/events/v1/events?per_page=50': 'hash-epos-p1-old',
      'https://eposfilis.gr/wp-json/tribe/events/v1/events?per_page=50&page=2': 'hash-epos-p2-old',
      'https://fop.gr/': 'hash-fop-old'
    };
    const newHashes = {
      'https://fop.gr/': 'hash-fop-new'
    };
    const fetchLogs = {
      'https://poa.gr/index.php/programma/': { success: false, code: 403 },
      'https://eposfilis.gr/wp-json/tribe/events/v1/events?per_page=50': { success: false, code: 403 },
      'https://fop.gr/': { success: true, code: 200 }
    };

    const merged = mergeContentHashes(prevHashes, newHashes, fetchLogs);
    assert.equal(merged['https://poa.gr/index.php/programma/'], 'hash-poa-old');
    assert.equal(merged['https://eposfilis.gr/wp-json/tribe/events/v1/events?per_page=50'], 'hash-epos-p1-old');
    assert.equal(merged['https://eposfilis.gr/wp-json/tribe/events/v1/events?per_page=50&page=2'], 'hash-epos-p2-old');
    assert.equal(merged['https://fop.gr/'], 'hash-fop-new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('debug-fetch: probes dynamically ONLY failed URLs and skips probing when all succeeded', async () => {
  const dir = makeTempDir();
  try {
    const outFile = path.join(dir, 'debug-output.txt');

    // Case 1: all succeeded -> 0 fetch calls
    fs.writeFileSync(path.join(dir, 'fetch-status.json'), JSON.stringify({
      'https://fop.gr/': { success: true, code: 200, status: 'OK', slug: 'fop_gr' }
    }));
    let calls = 0;
    const res1 = await probeFailedFetches({
      inputDir: dir,
      outputFile: outFile,
      fetchImpl: async () => { calls++; throw new Error('Should not be called'); }
    });
    assert.equal(res1.probedCount, 0);
    assert.equal(calls, 0);
    assert.ok(fs.readFileSync(outFile, 'utf-8').includes('All fetched URLs succeeded'));

    // Case 2: 1 failed URL -> probes exactly that URL
    fs.writeFileSync(path.join(dir, 'fetch-status.json'), JSON.stringify({
      'https://fop.gr/': { success: true, code: 200, status: 'OK', slug: 'fop_gr' },
      'https://poa.gr/index.php/programma/': { success: false, code: 403, status: 'Cloudflare', slug: 'poa_gr' }
    }));
    const probedUrls = [];
    const res2 = await probeFailedFetches({
      inputDir: dir,
      outputFile: outFile,
      fetchImpl: async (url) => {
        probedUrls.push(url);
        return {
          status: 403,
          statusText: 'Forbidden',
          headers: new Map([['server', 'cloudflare'], ['cf-ray', '12345']]),
          text: async () => '<html>Just a moment...</html>'
        };
      }
    });
    assert.equal(res2.probedCount, 1);
    assert.deepEqual(probedUrls, ['https://poa.gr/index.php/programma/']);
    const debugText = fs.readFileSync(outFile, 'utf-8');
    assert.ok(debugText.includes('poa.gr/index.php/programma/'));
    assert.ok(debugText.includes('cf-ray: 12345'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parse-events: deduplicateEvents removes cross-date duplicate on same dedicated URL without touching distinct fragment URLs', () => {
  const input = [
    {
      startDate: '2026-12-12',
      endDate: '2026-12-13',
      displayDate: '12-13/12',
      title: 'Αχαϊα: Χελμός, «Χτένια» Ψηλή Κορφή',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/11-13-12-chelmos/',
      difficulty: '3, 4'
    },
    {
      startDate: '2026-12-11',
      endDate: '2026-12-13',
      displayDate: '11-13/12',
      title: 'Αχαϊα: Χελμός, «Χτένια» παλιά ημερομηνία',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/11-13-12-chelmos',
      difficulty: '4'
    },
    // Two distinct EOS Athinon events on different dates using #MM-YY:~:text= must NOT collide
    {
      startDate: '2026-12-06',
      endDate: '2026-12-06',
      displayDate: '6/12',
      title: 'ΟΙΤΗ – Πυρά Ηρακλέους',
      club: 'ΕΟΣ Αθηνών',
      url: 'https://www.eosathinon.gr/anavaseis/programma/#12-26:~:text=OITH',
      difficulty: '1-2'
    },
    {
      startDate: '2026-12-13',
      endDate: '2026-12-13',
      displayDate: '13/12',
      title: 'ΣΤΕΜΝΙΤΣΑ – ΚΛΙΝΙΤΣΑ',
      club: 'ΕΟΣ Αθηνών',
      url: 'https://www.eosathinon.gr/anavaseis/programma/#12-26:~:text=STEMNITSA',
      difficulty: '2'
    }
  ];

  const deduped = deduplicateEvents(input);
  assert.equal(deduped.length, 3);
  const chelmos = deduped.find(e => e.club === 'ΕΠΟΣ Φυλής');
  assert.equal(chelmos.startDate, '2026-12-12');
  assert.equal(chelmos.difficulty, '3, 4');

  // Deterministic tie-break sort
  const tieA = [
    { startDate: '2027-01-31', endDate: '2027-01-31', club: 'ΕΟΣ Αχαρνών', title: 'Παρνασσός', url: 'https://a/1' },
    { startDate: '2027-01-31', endDate: '2027-01-31', club: 'ΕΟΣ Αχαρνών', title: 'Διάσχιση', url: 'https://a/2' }
  ];
  const tieB = [...tieA].reverse();
  assert.deepEqual(sortEventsDeterministically(tieA), sortEventsDeterministically(tieB));
});

test('detect-anomalies: escalates fetch fallback only on 2nd consecutive run, is idempotent on same status timestamp, and escalates HTTP 200 parser errors immediately', () => {
  const dir = makeTempDir();
  try {
    const paths = {
      eventsFile: path.join(dir, 'events.json'),
      baselineFile: path.join(dir, 'health-baseline.json'),
      statusFile: path.join(dir, 'status.json'),
      clubHealthFile: path.join(dir, 'club-health.json'),
      linkConfigFile: path.join(dir, 'link-config.json'),
      linksMdFile: path.join(dir, 'LINKS.md'),
      currentHashesFile: path.join(dir, 'content-hashes.json'),
      oldHashesFile: path.join(dir, 'content-hashes-old.json'),
      reportFile: path.join(dir, 'anomaly_report.md')
    };

    const poaEvents = [
      { startDate: '2027-01-10', endDate: '2027-01-10', displayDate: '10/1', title: 'Πάρνηθα', club: 'ΠΟΑ', url: 'https://poa.gr/index.php/programma/#:~:text=1', difficulty: '1' },
      { startDate: '2027-01-17', endDate: '2027-01-17', displayDate: '17/1', title: 'Υμηττός', club: 'ΠΟΑ', url: 'https://poa.gr/index.php/programma/#:~:text=2', difficulty: '1' },
      { startDate: '2027-01-24', endDate: '2027-01-24', displayDate: '24/1', title: 'Πεντέλη', club: 'ΠΟΑ', url: 'https://poa.gr/index.php/programma/#:~:text=3', difficulty: '2' }
    ];
    const fopEvents = [
      { startDate: '2027-01-10', endDate: '2027-01-10', displayDate: '10/1', title: 'Γκιώνα', club: 'ΦΟΠ', url: 'https://fop.gr/#:~:text=1', difficulty: '3' },
      { startDate: '2027-01-17', endDate: '2027-01-17', displayDate: '17/1', title: 'Βαρδούσια', club: 'ΦΟΠ', url: 'https://fop.gr/#:~:text=2', difficulty: '2' }
    ];

    fs.writeFileSync(paths.linkConfigFile, JSON.stringify({
      'ΠΟΑ': ['https://poa.gr/index.php/programma/'],
      'ΦΟΠ': ['https://fop.gr/']
    }));
    fs.writeFileSync(paths.baselineFile, JSON.stringify({ 'ΠΟΑ': poaEvents, 'ΦΟΠ': fopEvents }));
    fs.writeFileSync(paths.eventsFile, JSON.stringify([...poaEvents, ...fopEvents]));
    fs.writeFileSync(paths.currentHashesFile, '{}');
    fs.writeFileSync(paths.oldHashesFile, '{}');

    // Run 1: ΠΟΑ gets Cloudflare 403 fallback -> transient_fallback, NO anomaly_report.md
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-27T11:17:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'warning', details: 'Error: 0 parsed - preserved 3 healthy events', parsedCount: 0, preservedCount: 3, fallback: 'full', fetchFailed: true, fetchErrorSummary: 'HTTP 403 (Cloudflare / anti-bot)' },
        { club: 'ΦΟΠ', status: 'success', details: 'Parsed 2 events', parsedCount: 2, preservedCount: 0, fallback: 'none', fetchFailed: false }
      ]
    }));

    const r1 = detectAnomalies({ paths, todayStr: '2026-11-27', nowIso: '2026-11-27T11:17:05.000Z' });
    assert.equal(r1.hasCriticalAnomalies, false);
    assert.equal(fs.existsSync(paths.reportFile), false);
    assert.equal(r1.clubHealth.clubs['ΠΟΑ'].status, 'transient_fallback');
    assert.equal(r1.clubHealth.clubs['ΠΟΑ'].consecutiveFetchFallbacks, 1);

    // Re-run on SAME status timestamp (like `npm run test:anomalies`) -> must NOT double-increment!
    const r1Repeat = detectAnomalies({ paths, todayStr: '2026-11-27', nowIso: '2026-11-27T11:18:00.000Z' });
    assert.equal(r1Repeat.hasCriticalAnomalies, false);
    assert.equal(r1Repeat.clubHealth.clubs['ΠΟΑ'].consecutiveFetchFallbacks, 1);
    assert.equal(fs.existsSync(paths.reportFile), false);

    // Run 2 (new timestamp): ΠΟΑ STILL blocked -> escalates to critical_fallback and writes anomaly_report.md!
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-27T21:23:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'warning', details: 'Error: 0 parsed - preserved 3 healthy events', parsedCount: 0, preservedCount: 3, fallback: 'full', fetchFailed: true, fetchErrorSummary: 'HTTP 403 (Cloudflare / anti-bot)' },
        { club: 'ΦΟΠ', status: 'success', details: 'Parsed 2 events', parsedCount: 2, preservedCount: 0, fallback: 'none', fetchFailed: false }
      ]
    }));

    const r2 = detectAnomalies({ paths, todayStr: '2026-11-27', nowIso: '2026-11-27T21:23:05.000Z' });
    assert.equal(r2.hasCriticalAnomalies, true);
    assert.equal(r2.clubHealth.clubs['ΠΟΑ'].status, 'critical_fallback');
    assert.equal(r2.clubHealth.clubs['ΠΟΑ'].consecutiveFetchFallbacks, 2);
    assert.equal(fs.existsSync(paths.reportFile), true);
    assert.ok(fs.readFileSync(paths.reportFile, 'utf-8').includes('Mount Athens Self-Heal'));

    // Run 3: ΠΟΑ recovers -> counters reset to 0 and anomaly_report.md is removed!
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-28T11:17:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'success', details: 'Parsed 3 events', parsedCount: 3, preservedCount: 0, fallback: 'none', fetchFailed: false },
        { club: 'ΦΟΠ', status: 'success', details: 'Parsed 2 events', parsedCount: 2, preservedCount: 0, fallback: 'none', fetchFailed: false }
      ]
    }));

    const r3 = detectAnomalies({ paths, todayStr: '2026-11-28', nowIso: '2026-11-28T11:17:05.000Z' });
    assert.equal(r3.hasCriticalAnomalies, false);
    assert.equal(r3.clubHealth.clubs['ΠΟΑ'].status, 'healthy');
    assert.equal(r3.clubHealth.clubs['ΠΟΑ'].consecutiveFetchFallbacks, 0);
    assert.equal(r3.clubHealth.degradedClubs.length, 0);
    assert.equal(fs.existsSync(paths.reportFile), false);

    // Run 4: HTTP 200 succeeded for ΦΟΠ, yet parser returned 0 events (fetchFailed: false) -> IMMEDIATE Critical Anomaly!
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-28T21:23:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'success', details: 'Parsed 3 events', parsedCount: 3, preservedCount: 0, fallback: 'none', fetchFailed: false },
        { club: 'ΦΟΠ', status: 'warning', details: 'Error: 0 parsed (0 events parsed on HTTP 200) - preserved 2 healthy events', parsedCount: 0, preservedCount: 2, fallback: 'full', fetchFailed: false }
      ]
    }));

    const r4 = detectAnomalies({ paths, todayStr: '2026-11-28', nowIso: '2026-11-28T21:23:05.000Z' });
    assert.equal(r4.hasCriticalAnomalies, true);
    assert.equal(r4.clubHealth.clubs['ΦΟΠ'].status, 'parser_error');
    assert.equal(fs.existsSync(paths.reportFile), true);

    // Run 5: HTTP 200 drop of -2 events on ΠΟΑ (3 -> 1) -> IMMEDIATE event_drop Critical Anomaly; --accept-baseline clears it
    fs.writeFileSync(paths.eventsFile, JSON.stringify([poaEvents[0], ...fopEvents]));
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-29T11:17:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'success', details: 'Parsed 1 events', parsedCount: 1, preservedCount: 0, fallback: 'none', fetchFailed: false },
        { club: 'ΦΟΠ', status: 'success', details: 'Parsed 2 events', parsedCount: 2, preservedCount: 0, fallback: 'none', fetchFailed: false }
      ]
    }));

    const r5 = detectAnomalies({ paths, todayStr: '2026-11-29', nowIso: '2026-11-29T11:17:05.000Z' });
    assert.equal(r5.hasCriticalAnomalies, true);
    assert.equal(r5.clubHealth.clubs['ΠΟΑ'].status, 'event_drop');

    const r5Accept = detectAnomalies({ paths, todayStr: '2026-11-29', nowIso: '2026-11-29T11:20:00.000Z', acceptBaseline: true });
    assert.equal(r5Accept.hasCriticalAnomalies, false);
    assert.equal(r5Accept.clubHealth.clubs['ΠΟΑ'].status, 'healthy');
    assert.equal(fs.existsSync(paths.reportFile), false);

    // --test-alert writes report without corrupting club-health.json
    const healthBeforeTest = fs.readFileSync(paths.clubHealthFile, 'utf-8');
    const rTest = detectAnomalies({ paths, todayStr: '2026-11-29', testAlert: true });
    assert.equal(rTest.hasCriticalAnomalies, true);
    assert.equal(fs.existsSync(paths.reportFile), true);
    assert.equal(fs.readFileSync(paths.clubHealthFile, 'utf-8'), healthBeforeTest);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('send-notifications: notifies healthy club added & changed events during another club fallback, handles same-date replacement, cancellations, noise suppression, and recovery', () => {
  const todayStr = '2026-11-27';
  const nowIso = '2026-11-27T12:00:00.000Z';

  const initialLedger = {
    version: 1,
    updatedAt: '2026-11-26T03:00:00.000Z',
    events: [
      // EPOS Filis: Chelmos (will reschedule + change difficulty + route)
      createLedgerEntry({
        startDate: '2026-12-11',
        endDate: '2026-12-13',
        displayDate: '11-13/12',
        title: 'Αχαϊα: Α) Χελμός, «Χτένια» Ψηλή Κορφή Β) Πεζοπορίες: Λίμνη Δόξας',
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/event/11-13-12-chelmos/',
        difficulty: '1, 1+, 3, 4'
      }, '2026-11-20T00:00:00.000Z'),
      // EPOS Filis: Ortari (will expand route + change difficulty 2 -> 1, 2)
      createLedgerEntry({
        startDate: '2027-01-24',
        endDate: '2027-01-24',
        displayDate: '24/1',
        title: 'Εύβοια: κορυφή Ορτάρι (869 μ.), Κύμη',
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/event/24-1-27-ortari/',
        difficulty: '2'
      }, '2026-11-20T00:00:00.000Z'),
      // EOS Ilioupolis: will be cancelled (future event startDate > todayStr)
      createLedgerEntry({
        startDate: '2026-11-29',
        endDate: '2026-11-29',
        displayDate: '29/11',
        title: 'Βόρειος Ταύγετος (Καστόρι-Φαράγγι Μύλων)',
        club: 'ΕΟΣ Ηλιούπολης',
        url: 'https://eosh.gr/expeditions/voreios-taygetos',
        difficulty: '2'
      }, '2026-11-20T00:00:00.000Z'),
      // EOS Ilioupolis: already started/today -> should silently expire, NOT cancel
      createLedgerEntry({
        startDate: '2026-11-27',
        endDate: '2026-11-28',
        displayDate: '27-28/11',
        title: 'Παναιτωλικό Όρος (εν εξελίξει)',
        club: 'ΕΟΣ Ηλιούπολης',
        url: 'https://eosh.gr/expeditions/panaitoliko',
        difficulty: '2'
      }, '2026-11-20T00:00:00.000Z'),
      // EOS Ilioupolis: URL slug tweak only -> SILENT
      createLedgerEntry({
        startDate: '2027-06-19',
        endDate: '2027-06-21',
        displayDate: '19-21/6',
        title: 'Γράμμος (Τριήμερο Αγ. Πνεύματος)',
        club: 'ΕΟΣ Ηλιούπολης',
        url: 'https://eosh.gr/expeditions/gramms-old-slug',
        difficulty: '2+'
      }, '2026-11-20T00:00:00.000Z'),
      // EOS Ilioupolis: minor typo tweak -> SILENT
      createLedgerEntry({
        startDate: '2027-03-21',
        endDate: '2027-03-21',
        displayDate: '21/3',
        title: 'Μαραθώνας (πύργος Οινόης-Οινόη)',
        club: 'ΕΟΣ Ηλιούπολης',
        url: 'https://eosh.gr/expeditions/marathon-oinoe',
        difficulty: '1'
      }, '2026-11-20T00:00:00.000Z'),
      // AOS: blank -> filled difficulty + fallback URL -> dedicated URL -> SILENT
      createLedgerEntry({
        startDate: '2026-12-26',
        endDate: '2026-12-26',
        displayDate: '26 Δεκε',
        title: 'Πάρνηθα – Κόψη Φλαμπουρίου',
        club: 'ΑΟΣ',
        url: 'https://aos.gr/trechouses-kai-eperchomenes-anavaseis-kai-ekdiloseis/#:~:text=Parnitha',
        difficulty: ''
      }, '2026-11-20T00:00:00.000Z'),
      // FOP: Same-date replacement (Parnitha cancelled, Olympus added on SAME date!)
      createLedgerEntry({
        startDate: '2027-02-14',
        endDate: '2027-02-14',
        displayDate: '14/2',
        title: 'ΠΑΡΝΗΘΑ - ΚΑΤΑΦΥΓΙΟ ΜΠΑΦΙ',
        club: 'ΦΟΠ',
        url: 'https://fop.gr/#:~:text=PARNITHA',
        difficulty: '1'
      }, '2026-11-20T00:00:00.000Z'),
      // FOP: Rescheduled WITHOUT dedicated URL (moves 1 week later with same title)
      createLedgerEntry({
        startDate: '2027-03-07',
        endDate: '2027-03-07',
        displayDate: '7/3',
        title: 'Νότια Πίνδος: ΛΟΥΠΑΤΑ & ΑΥΓΟ',
        club: 'ΦΟΠ',
        url: 'https://fop.gr/#:~:text=LOUPATA',
        difficulty: '3'
      }, '2026-11-20T00:00:00.000Z'),
      // POA: currently in Cloudflare fallback -> must stay frozen (NO cancellations!)
      createLedgerEntry({
        startDate: '2027-01-17',
        endDate: '2027-01-17',
        displayDate: '17/1',
        title: 'Μαίναλο Βυτίνα',
        club: 'ΠΟΑ',
        url: 'https://poa.gr/index.php/programma/#:~:text=Mainalo',
        difficulty: '1'
      }, '2026-11-20T00:00:00.000Z')
    ]
  };

  const currentEvents = [
    // EPOS Filis: Chelmos changed
    {
      startDate: '2026-12-12',
      endDate: '2026-12-13',
      displayDate: '12-13/12',
      title: 'Αχαϊα: Χελμός, «Χτένια» Ψηλή Κορφή (Λίμνη Δόξας – Καλάβρυτα)',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/11-13-12-chelmos/',
      difficulty: '3, 4'
    },
    // EPOS Filis: Notios Ymittos ADDED
    {
      startDate: '2027-01-10',
      endDate: '2027-01-10',
      displayDate: '10/1',
      title: 'Νότιος Υμηττός : Τρύπια Σπηλιά – Διάσελο Σταυρού',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/10-1-2027-ymittos/',
      difficulty: '1+'
    },
    // EPOS Filis: Ortari changed
    {
      startDate: '2027-01-24',
      endDate: '2027-01-24',
      displayDate: '24/1',
      title: 'Εύβοια: Α) κορυφή Ορτάρι (869 μ.), Β) Κοτυλαία όρη (1.005μ.), διάσχιση, Κύμη.',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/24-1-27-ortari/',
      difficulty: '1, 2'
    },
    // EOS Ilioupolis: Grammos slug changed only -> SILENT
    {
      startDate: '2027-06-19',
      endDate: '2027-06-21',
      displayDate: '19-21/6',
      title: 'Γράμμος (Τριήμερο Αγ. Πνεύματος)',
      club: 'ΕΟΣ Ηλιούπολης',
      url: 'https://eosh.gr/expeditions/grammos-new-slug',
      difficulty: '2+'
    },
    // EOS Ilioupolis: Marathon minor typo tweak -> SILENT
    {
      startDate: '2027-03-21',
      endDate: '2027-03-21',
      displayDate: '21/3',
      title: 'Μαραθώνας (Φαράγγι Οινόης-Πυργος Οινόης)',
      club: 'ΕΟΣ Ηλιούπολης',
      url: 'https://eosh.gr/expeditions/marathon-oinoe',
      difficulty: '1'
    },
    // AOS: difficulty enriched + dedicated URL -> SILENT
    {
      startDate: '2026-12-26',
      endDate: '2026-12-26',
      displayDate: '26 Δεκε',
      title: 'Πάρνηθα – Κόψη Φλαμπουρίου',
      club: 'ΑΟΣ',
      url: 'https://aos.gr/26-12-parnitha-kopsi-flabouriou/',
      difficulty: '2'
    },
    // FOP: Same-date replacement (Olympus replaces Parnitha on 2027-02-14)
    {
      startDate: '2027-02-14',
      endDate: '2027-02-14',
      displayDate: '14/2',
      title: 'ΟΛΥΜΠΟΣ - ΠΕΤΡΟΣΤΡΟΥΓΚΑ',
      club: 'ΦΟΠ',
      url: 'https://fop.gr/#:~:text=OLYMPOS',
      difficulty: '3'
    },
    // FOP: Loupata moved 1 week later (2027-03-07 -> 2027-03-14)
    {
      startDate: '2027-03-14',
      endDate: '2027-03-14',
      displayDate: '14/3',
      title: 'Νότια Πίνδος: ΛΟΥΠΑΤΑ & ΑΥΓΟ',
      club: 'ΦΟΠ',
      url: 'https://fop.gr/#:~:text=LOUPATA',
      difficulty: '3'
    }
    // Note: POA events intentionally empty here while POA is in fallback to verify POA ledger stays untouched
  ];

  const statusData = {
    lastUpdated: nowIso,
    logs: [
      { club: 'ΕΠΟΣ Φυλής', status: 'success', details: 'Parsed 3 events' },
      { club: 'ΕΟΣ Ηλιούπολης', status: 'success', details: 'Parsed 2 events' },
      { club: 'ΑΟΣ', status: 'success', details: 'Parsed 1 events' },
      { club: 'ΦΟΠ', status: 'success', details: 'Parsed 2 events' },
      { club: 'ΠΟΑ', status: 'warning', details: 'Error: 0 parsed - preserved 1 healthy events' }
    ]
  };

  const diff1 = diffEventsWithLedger({ currentEvents, ledger: initialLedger, statusData, todayStr, nowIso });

  // Added: Ymittos (EPOS Filis) + Olympos (FOP same-date replacement!)
  assert.deepEqual(diff1.addedEvents.map(e => e.title), [
    'Νότιος Υμηττός : Τρύπια Σπηλιά – Διάσελο Σταυρού',
    'ΟΛΥΜΠΟΣ - ΠΕΤΡΟΣΤΡΟΥΓΚΑ'
  ]);

  // Changed: Chelmos + Ortari (EPOS Filis) + Loupata (FOP rescheduled without dedicated URL)
  assert.equal(diff1.changedEvents.length, 3);
  assert.equal(diff1.changedEvents[0].changes.dateChanged, true);
  assert.equal(diff1.changedEvents[0].changes.difficultyChanged, true);
  assert.equal(diff1.changedEvents[1].changes.difficultyChanged, true);
  assert.equal(diff1.changedEvents[2].changes.dateChanged, true);
  assert.equal(diff1.changedEvents[2].current.club, 'ΦΟΠ');

  // Cancelled: Taygetos (Ilioupolis) + Parnitha (FOP same-date replacement!).
  // Must NOT include Panaitoliko (startDate === todayStr) or Mainalo (POA in fallback)!
  assert.deepEqual(diff1.cancelledEvents.map(e => e.title), [
    'Βόρειος Ταύγετος (Καστόρι-Φαράγγι Μύλων)',
    'ΠΑΡΝΗΘΑ - ΚΑΤΑΦΥΓΙΟ ΜΠΑΦΙ'
  ]);

  // Idempotency: re-running with nextLedger produces ZERO alerts
  const diff2 = diffEventsWithLedger({ currentEvents, ledger: diff1.nextLedger, statusData, todayStr, nowIso });
  assert.equal(diff2.addedEvents.length, 0);
  assert.equal(diff2.changedEvents.length, 0);
  assert.equal(diff2.cancelledEvents.length, 0);

  // Recovery: POA comes back healthy with 1 brand new event (plus existing Mainalo) -> detected!
  const recoveredEvents = [
    ...currentEvents,
    { startDate: '2027-01-17', endDate: '2027-01-17', displayDate: '17/1', title: 'Μαίναλο Βυτίνα', club: 'ΠΟΑ', url: 'https://poa.gr/index.php/programma/#:~:text=Mainalo', difficulty: '1' },
    { startDate: '2027-02-21', endDate: '2027-02-21', displayDate: '21/2', title: 'Δίρφυς – Καταφύγιο', club: 'ΠΟΑ', url: 'https://poa.gr/index.php/programma/#:~:text=Dirfys', difficulty: '2' }
  ];
  const recoveredStatus = {
    lastUpdated: '2026-11-27T21:23:00.000Z',
    logs: statusData.logs.map(l => l.club === 'ΠΟΑ' ? { club: 'ΠΟΑ', status: 'success', details: 'Parsed 2 events' } : l)
  };
  const diff3 = diffEventsWithLedger({
    currentEvents: recoveredEvents,
    ledger: diff1.nextLedger,
    statusData: recoveredStatus,
    todayStr,
    nowIso: '2026-11-27T21:23:00.000Z'
  });
  assert.deepEqual(diff3.addedEvents.map(e => e.title), ['Δίρφυς – Καταφύγιο']);
  assert.equal(diff3.changedEvents.length, 0);
  assert.equal(diff3.cancelledEvents.length, 0);
});

test('send-notifications: mass-cancellation guard protects subscribers from parser wipeouts and reactivates un-cancelled events', () => {
  const todayStr = '2026-11-27';
  const nowIso = '2026-11-27T12:00:00.000Z';

  const ledger = {
    version: 1,
    updatedAt: nowIso,
    events: [1, 2, 3, 4].map(n => createLedgerEntry({
      startDate: `2027-02-0${n}`,
      endDate: `2027-02-0${n}`,
      displayDate: `${n}/2`,
      title: `Εξόρμηση ${n}`,
      club: 'ΦΟΠ',
      url: `https://fop.gr/#:~:text=${n}`,
      difficulty: '1'
    }, nowIso))
  };

  // 3 of 4 (75%) vanish -> mass cancellation guard suppresses broadcast and flags admin!
  const diff = diffEventsWithLedger({
    currentEvents: [{
      startDate: '2027-02-01',
      endDate: '2027-02-01',
      displayDate: '1/2',
      title: 'Εξόρμηση 1',
      club: 'ΦΟΠ',
      url: 'https://fop.gr/#:~:text=1',
      difficulty: '1'
    }],
    ledger,
    statusData: { lastUpdated: nowIso, logs: [{ club: 'ΦΟΠ', status: 'success', details: 'Parsed 1 events' }] },
    todayStr,
    nowIso
  });

  assert.equal(diff.cancelledEvents.length, 0);
  assert.equal(diff.suppressedMassCancellations.length, 1);
  assert.equal(diff.suppressedMassCancellations[0].count, 3);

  // Reactivating a previously cancelled event notifies as ADDED
  const ledgerWithCancelled = {
    version: 1,
    updatedAt: nowIso,
    events: [
      createLedgerEntry({
        startDate: '2027-02-10',
        endDate: '2027-02-10',
        displayDate: '10/2',
        title: 'Κιθαιρώνας',
        club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/event/kithaironas/',
        difficulty: '1'
      }, nowIso, 'cancelled')
    ]
  };
  const reactivated = diffEventsWithLedger({
    currentEvents: [{
      startDate: '2027-02-10',
      endDate: '2027-02-10',
      displayDate: '10/2',
      title: 'Κιθαιρώνας',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/kithaironas/',
      difficulty: '1'
    }],
    ledger: ledgerWithCancelled,
    statusData: { lastUpdated: nowIso, logs: [{ club: 'ΕΠΟΣ Φυλής', status: 'success', details: 'Parsed 1 events' }] },
    todayStr,
    nowIso
  });
  assert.equal(reactivated.addedEvents.length, 1);
  assert.equal(reactivated.nextLedger.events.filter(e => e.status === 'active').length, 1);
  assert.equal(reactivated.nextLedger.events.filter(e => e.status === 'cancelled').length, 0);
});

test('send-notifications: subscriber messages & plain-language admin alerts contain valid HTML without raw Markdown', () => {
  const prev = {
    startDate: '2026-12-11',
    endDate: '2026-12-13',
    displayDate: '11-13/12',
    title: 'Χελμός <Α & Β>',
    club: 'ΕΠΟΣ Φυλής',
    url: 'https://eposfilis.gr/event/chelmos/',
    difficulty: '1, 4'
  };
  const curr = { ...prev, startDate: '2026-12-12', displayDate: '12-13/12', difficulty: '3, 4' };

  const msgs = buildSubscriberMessages({
    clubs: ['ΕΠΟΣ Φυλής'],
    addedEvents: [{
      startDate: '2027-01-10',
      endDate: '2027-01-10',
      displayDate: '10/1',
      title: 'Νότιος Υμηττός',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/ymittos/',
      difficulty: '1+'
    }],
    changedEvents: [{ previous: prev, current: curr, changes: classifyEventChange(prev, curr, '2026') }],
    cancelledEvents: [{
      startDate: '2027-01-17',
      endDate: '2027-01-17',
      displayDate: '17/1',
      title: 'Ακυρωμένη Πάρνηθα',
      club: 'ΕΠΟΣ Φυλής',
      url: 'https://eposfilis.gr/event/parnitha/',
      difficulty: '2'
    }],
    currentYear: '2026'
  });

  const tg = msgs.telegramMessages.join('\n');
  assert.ok(tg.includes('10/1/2027'));
  assert.ok(tg.includes('&lt;Α &amp; Β&gt;'), 'HTML special chars must be escaped');
  assert.ok(!tg.includes('**'), 'Telegram HTML must not contain raw Markdown **');
  assert.ok(tg.includes('➕ Νέες εξορμήσεις'));
  assert.ok(tg.includes('🔄 Αλλαγές σε εξορμήσεις'));
  assert.ok(tg.includes('❌ Ακυρώσεις εξορμήσεων'));
  // Cancelled event must NOT link to a broken #ev-2027-01-17 anchor
  assert.ok(!tg.includes('#ev-2027-01-17'));

  // Admin alert: Run-1 transient block
  const transientAlert = buildAdminHealthAlert({
    clubHealth: {
      clubs: {
        'ΠΟΑ': { status: 'transient_fallback', consecutiveFetchFallbacks: 1, lastError: 'HTTP 403 (Cloudflare)', preservedCount: 16 }
      }
    },
    subscriberSummary: 'Στάλθηκαν: +1 νέες (ΕΠΟΣ Φυλής)',
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/123',
    healthyClubsCount: 7,
    totalClubsCount: 8
  });
  assert.ok(transientAlert && transientAlert.length === 1);
  assert.ok(transientAlert[0].includes('Προσωρινό Μπλοκάρισμα (1η φορά)'));
  assert.ok(transientAlert[0].includes('Καμία ενέργεια τώρα'));
  assert.ok(transientAlert[0].includes('Στάλθηκαν: +1 νέες (ΕΠΟΣ Φυλής)'));
  assert.ok(transientAlert[0].includes('GitHub Actions Run'));
  assert.ok(!transientAlert[0].includes('**'));

  // Admin alert: Run-2 critical block
  const criticalAlert = buildAdminHealthAlert({
    clubHealth: {
      clubs: {
        'ΠΟΑ': { status: 'critical_fallback', consecutiveFetchFallbacks: 2, lastError: 'HTTP 403', preservedCount: 16 }
      }
    },
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/124',
    issueUrl: 'https://github.com/kostis-kounadis/Mount-Athens/issues/19',
    issueAction: 'created',
    healthyClubsCount: 7,
    totalClubsCount: 8
  });
  assert.ok(criticalAlert[0].includes('Επίμονο Μπλοκάρισμα IP'));
  assert.ok(criticalAlert[0].includes('local self-heal'));
  assert.ok(criticalAlert[0].includes('GitHub Issue #19'));

  // Admin alert: Recovery
  const recoveryAlert = buildAdminHealthAlert({
    clubHealth: { clubs: { 'ΠΟΑ': { status: 'healthy' } } },
    issueUrl: 'https://github.com/kostis-kounadis/Mount-Athens/issues/19',
    issueAction: 'closed',
    healthyClubsCount: 8,
    totalClubsCount: 8
  });
  assert.ok(recoveryAlert[0].includes('Αυτόματη Επαναφορά'));

  // Healthy run with no issue closed -> null (no spam)
  const quiet = buildAdminHealthAlert({
    clubHealth: { clubs: { 'ΠΟΑ': { status: 'healthy' } } },
    issueAction: 'none'
  });
  assert.equal(quiet, null);
});

test('workflow and sidecar static invariants hold', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf-8');
  assert.ok(!workflow.includes(' -jq '), 'Workflow must not have broken single-dash -jq flag');
  assert.ok(workflow.includes('--jq '), 'Workflow must use --jq');
  assert.ok(workflow.includes('concurrency:'), 'Workflow must define concurrency');
  assert.ok(!workflow.includes('src/data/debug-output.txt'), 'Workflow must not commit src/data/debug-output.txt');
  assert.ok(workflow.includes('src/data/notified-events.json'), 'Workflow must commit notified-events.json');
  assert.ok(workflow.includes("cron: '17 11 * * *'"), 'Workflow cron must be off :00');
  assert.ok(workflow.includes("if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"));

  // Verify Fetch & Parse step has no continue-on-error
  const fetchStepBlock = workflow.split('- name: Fetch & Parse Latest Excursions')[1].split('- name: Report or Auto-Close')[0];
  assert.ok(!fetchStepBlock.includes('continue-on-error: true'), 'Fetch & Parse must not use continue-on-error: true');

  // Verify Report or Auto-Close only runs on success (never auto-closes on crash) and isolates test_alert
  const reportStepBlock = workflow.split('- name: Report or Auto-Close Anomalies via GitHub Issues')[1].split('- name: Upload Scraper')[0];
  assert.ok(reportStepBlock.includes('if: success()'), 'Report or Auto-Close must use if: success(), not if: always()');
  assert.ok(!reportStepBlock.includes('if: always()'));
  assert.ok(reportStepBlock.includes('set -o pipefail'), 'Report step must use pipefail so failed gh issue create is never masked');
  assert.ok(reportStepBlock.includes('test-alert'), 'Test alerts must use separate label from real anomaly issues');
  assert.ok(workflow.includes('IS_TEST_ALERT:'), 'Workflow must pass IS_TEST_ALERT to send-notifications.js');
  assert.ok(workflow.includes('IS_SELF_HEAL_PUSH:'), 'Workflow must pass IS_SELF_HEAL_PUSH to send-notifications.js');
  assert.ok(
    workflow.includes("startsWith(github.event.head_commit.message, 'chore(data): self-heal')"),
    'IS_SELF_HEAL_PUSH must match chore(data): self-heal commits'
  );
  assert.ok(!workflow.includes('git diff-index'), 'Workflow commit steps must not use git diff-index (unstaged files could break git commit)');
  const cachedDiffMatches = workflow.match(/git diff --cached --quiet/g) || [];
  assert.equal(cachedDiffMatches.length, 2, 'Both commit steps in deploy.yml must guard commits with git diff --cached --quiet');

  // Verify .gitignore anchors /data/
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
  assert.ok(gitignore.includes('\n/data/\n'), '.gitignore must anchor /data/');
  assert.ok(!gitignore.split('\n').includes('data/'), '.gitignore must not contain unanchored data/');

  // Verify sidecar JSON if present on this machine
  const sidecarPath = '/Users/kkounadi/.gemini/config/sidecars/mount-athens-self-heal/sidecar.json';
  if (fs.existsSync(sidecarPath)) {
    const raw = fs.readFileSync(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const scheduleArg = parsed.args[0];
    const prompt = parsed.args[parsed.args.length - 1];
    assert.ok(!raw.includes('update_issue'), 'Sidecar must not reference nonexistent update_issue tool');
    assert.ok(parsed.agent_permissions.access_grants.includes('mcp(github-mcp-server/issue_write)'));
    assert.ok(parsed.agent_permissions.access_grants.includes('command(git restore)'), 'Sidecar must have git restore grant to clean failed local scrapes');
    assert.equal(scheduleArg, 'CRON_TZ=Europe/Athens 45 9,14 * * *', 'Sidecar must run after both daily CI scrapes');
    assert.ok(prompt.includes('issue_write'));
    assert.ok(prompt.includes('github-actions'));
    assert.ok(prompt.includes('club-health.json'));
    assert.ok(prompt.includes('local_self_heal'), 'Sidecar must only run local scrape for local_self_heal anomalies');
    assert.ok(prompt.includes('git restore src/data/'), 'Sidecar must restore dirty data files if local scrape still fails');
    assert.ok(!prompt.includes('Do NOT send any alert or notification'), 'Sidecar must report what it did');
  }
});

test('regression: baseline:accept unlocks mass-cancellation guard cleanly without deadlock', () => {
  const dir = makeTempDir();
  try {
    const paths = {
      eventsFile: path.join(dir, 'events.json'),
      baselineFile: path.join(dir, 'health-baseline.json'),
      statusFile: path.join(dir, 'status.json'),
      clubHealthFile: path.join(dir, 'club-health.json'),
      linkConfigFile: path.join(dir, 'link-config.json'),
      linksMdFile: path.join(dir, 'LINKS.md'),
      currentHashesFile: path.join(dir, 'content-hashes.json'),
      oldHashesFile: path.join(dir, 'content-hashes-old.json'),
      reportFile: path.join(dir, 'anomaly_report.md')
    };

    const all10 = Array.from({ length: 10 }, (_, i) => ({
      startDate: `2027-02-${String(i + 1).padStart(2, '0')}`,
      endDate: `2027-02-${String(i + 1).padStart(2, '0')}`,
      displayDate: `${i + 1}/2`,
      title: `Εξόρμηση ΦΟΠ ${i + 1}`,
      club: 'ΦΟΠ',
      url: `https://fop.gr/#:~:text=FOP${i + 1}`,
      difficulty: '2'
    }));
    const remaining7 = all10.slice(0, 7);

    fs.writeFileSync(paths.linkConfigFile, JSON.stringify({ 'ΦΟΠ': ['https://fop.gr/'] }));
    fs.writeFileSync(paths.baselineFile, JSON.stringify({ 'ΦΟΠ': all10 }));
    fs.writeFileSync(paths.eventsFile, JSON.stringify(remaining7));
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-27T11:17:00.000Z',
      logs: [{ club: 'ΦΟΠ', status: 'success', details: 'Parsed 7 events', parsedCount: 7, preservedCount: 0, fallback: 'none', fetchFailed: false }]
    }));

    const ledger = {
      version: 1,
      updatedAt: '2026-11-26T00:00:00.000Z',
      events: all10.map(e => createLedgerEntry(e, '2026-11-26T00:00:00.000Z'))
    };

    // Before baseline:accept -> event_drop suppresses cancellations
    const r1 = detectAnomalies({ paths, todayStr: '2026-11-27' });
    assert.equal(r1.clubHealth.clubs['ΦΟΠ'].status, 'event_drop');
    const statusData = JSON.parse(fs.readFileSync(paths.statusFile, 'utf-8'));
    const diffBefore = diffEventsWithLedger({
      currentEvents: remaining7,
      ledger,
      statusData,
      clubHealth: r1.clubHealth,
      todayStr: '2026-11-27'
    });
    assert.equal(diffBefore.cancelledEvents.length, 0);

    // Admin runs npm run baseline:accept -> unlocks mass cancellations for this scrape timestamp
    const r2 = detectAnomalies({ paths, todayStr: '2026-11-27', acceptBaseline: true });
    assert.equal(r2.clubHealth.baselineAcceptedForTimestamp, '2026-11-27T11:17:00.000Z');

    // Re-running test:anomalies on the same timestamp preserves baselineAcceptedForTimestamp
    const r2Repeat = detectAnomalies({ paths, todayStr: '2026-11-27' });
    assert.equal(r2Repeat.clubHealth.baselineAcceptedForTimestamp, '2026-11-27T11:17:00.000Z');

    const diffAfter = diffEventsWithLedger({
      currentEvents: remaining7,
      ledger,
      statusData,
      clubHealth: r2Repeat.clubHealth,
      todayStr: '2026-11-27'
    });
    assert.equal(diffAfter.cancelledEvents.length, 3);
    assert.equal(diffAfter.suppressedMassCancellations.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: multi-chunk subscriber messages never orphan section headers, split oversized blocks, and escape Markdown brackets', () => {
  for (let n = 15; n <= 35; n++) {
    const added = Array.from({ length: n }, (_, i) => ({
      startDate: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
      endDate: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
      displayDate: `${(i % 28) + 1}/1`,
      title: `Διάσχιση κορυφογραμμής Ολύμπου [Ομάδα ${i + 1}] από Λιτόχωρο μέχρι Πριόνια`,
      club: 'ΕΠΟΣ Φυλής',
      url: `https://eposfilis.gr/event/test-${i}/`,
      difficulty: '2+'
    }));
    const prev = { startDate: '2027-02-01', endDate: '2027-02-01', displayDate: '1/2', title: 'Χελμός παλιά', club: 'ΕΠΟΣ Φυλής', url: 'https://eposfilis.gr/event/c1/', difficulty: '2' };
    const curr = { ...prev, startDate: '2027-02-02', displayDate: '2/2', difficulty: '3' };
    const changed = [{ previous: prev, current: curr, changes: classifyEventChange(prev, curr, '2026') }];
    const cancelled = [{ startDate: '2027-02-10', endDate: '2027-02-10', displayDate: '10/2', title: 'Ακυρωμένη Πάρνηθα', club: 'ΕΠΟΣ Φυλής', url: 'https://eposfilis.gr/event/x1/', difficulty: '1' }];

    const res = buildSubscriberMessages({
      clubs: ['ΕΠΟΣ Φυλής'],
      addedEvents: added,
      changedEvents: changed,
      cancelledEvents: cancelled,
      currentYear: '2026'
    });
    for (const chunk of res.telegramMessages) {
      assert.ok(chunk.length <= 3900, `Chunk exceeded 3900 chars at n=${n}: ${chunk.length}`);
      const lastLine = chunk.trim().split('\n').pop();
      assert.ok(!/<b>[➕🔄❌]/.test(lastLine), `Orphaned section heading at n=${n}: ${lastLine}`);
    }
    assert.ok(res.emailBody.includes('\\[Ομάδα 1\\]'), 'Markdown brackets in link title must be escaped');
  }

  // Oversized single block > 3900 must still split cleanly <= 3900
  const huge = chunkTelegramBlocks('Header', ['<b>' + 'word '.repeat(900) + '</b>'], 'Footer', 3900);
  assert.ok(huge.length >= 2);
  for (const ch of huge) {
    assert.ok(ch.length <= 3900, `Huge block chunk exceeded 3900: ${ch.length}`);
  }
});

test('regression: parse-events triggers full resilience fallback when parser returns only past archive events', () => {
  const today = new Date('2026-11-27');
  const pastArchiveOnly = Array.from({ length: 15 }, (_, i) => ({
    startDate: `2026-05-${String(i + 1).padStart(2, '0')}`,
    endDate: `2026-05-${String(i + 1).padStart(2, '0')}`,
    displayDate: `${i + 1}/5`,
    title: `Παλιά εκδρομή ${i + 1}`,
    club: 'ΦΟΝΙ',
    url: `https://www.foni.org.gr/old-${i + 1}/`,
    difficulty: '1'
  }));
  const baselineUpcoming = [
    { startDate: '2026-12-06', endDate: '2026-12-06', displayDate: '6/12', title: 'Καμάρι', club: 'ΦΟΝΙ', url: 'https://www.foni.org.gr/kamari/', difficulty: '1' },
    { startDate: '2026-12-13', endDate: '2026-12-13', displayDate: '13/12', title: 'Λόφοι Αθήνας', club: 'ΦΟΝΙ', url: 'https://www.foni.org.gr/lofoi/', difficulty: '1, 2' }
  ];

  const resolved = resolveClubEventsWithFallback({
    club: 'ΦΟΝΙ',
    parsedList: pastArchiveOnly,
    baselineEvents: baselineUpcoming,
    anyUrlFailed: false,
    today
  });

  assert.equal(resolved.status, 'warning');
  assert.equal(resolved.meta.fallback, 'full');
  assert.equal(resolved.meta.parsedCount, 0);
  assert.equal(resolved.meta.preservedCount, 2);
  assert.equal(resolved.events.length, 2);
});

test('regression: Greek spelling/inflection noise is suppressed, destination swaps are detected, and duplicate-URL ledger recovery is clean', () => {
  // Real historical false-positive c622dc5: spelling + genitive inflection -> SILENT
  const ziriaChange = classifyEventChange(
    { startDate: '2026-12-13', endDate: '2026-12-13', displayDate: '13/12', title: 'Μικρή Ζήρια – Φλαμπουρίτσα', difficulty: '2' },
    { startDate: '2026-12-13', endDate: '2026-12-13', displayDate: '13/12', title: 'Μικρή Ζήρεια – Χαράδρα Φλαμπουρίτσας', difficulty: '2' },
    '2026'
  );
  assert.equal(ziriaChange.titleChanged, false);
  assert.equal(ziriaChange.isSignificant, false);

  // Real historical abbreviation 2f8ad06 -> SILENT
  const armaChange = classifyEventChange(
    { startDate: '2026-12-06', endDate: '2026-12-06', displayDate: '6/12', title: 'Επετειακή ανάβαση για τα 40 χρόνια του ΑΟΣ στο ΑΡΜΑ Πάρνηθας', difficulty: '1' },
    { startDate: '2026-12-06', endDate: '2026-12-06', displayDate: '6/12', title: 'Άρμα Πάρνηθας', difficulty: '1' },
    '2026'
  );
  assert.equal(armaChange.titleChanged, false);

  // Real refuge swap -> CHANGED!
  const refugeSwap = classifyEventChange(
    { startDate: '2027-02-14', endDate: '2027-02-14', displayDate: '14/2', title: 'Όλυμπος – Καταφύγιο Αγαπητός', difficulty: '2' },
    { startDate: '2027-02-14', endDate: '2027-02-14', displayDate: '14/2', title: 'Όλυμπος – Καταφύγιο Πετρόστρουγκα', difficulty: '2' },
    '2026'
  );
  assert.equal(refugeSwap.titleChanged, true);
  assert.equal(refugeSwap.isSignificant, true);

  // Real historical peak swap c38660b -> CHANGED!
  const peakSwap = classifyEventChange(
    { startDate: '2027-01-23', endDate: '2027-01-23', displayDate: '23/1', title: 'Κίσσαβος χειμερινή (κτφ Κισσάβου-κορυφή Παλαμιώτης)', difficulty: '5+' },
    { startDate: '2027-01-23', endDate: '2027-01-23', displayDate: '23/1', title: 'Κίσσαβος χειμερινή (κτφ Κισσάβου-κορυφή Προφ Ηλίας)', difficulty: '5+' },
    '2026'
  );
  assert.equal(peakSwap.titleChanged, true);

  // Duplicate-URL ledger recovery (ec11723 -> a1f3d42): must NOT emit bogus change + cancel!
  const dupLedger = {
    version: 1,
    updatedAt: '2026-11-26T10:00:00.000Z',
    events: [
      createLedgerEntry({
        startDate: '2026-12-11', endDate: '2026-12-13', displayDate: '11-13/12',
        title: 'Αχαϊα: Χελμός, «Χτένια» παλιά', club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/event/11-13-12-chelmos/', difficulty: '4'
      }, '2026-11-26T10:00:00.000Z'),
      createLedgerEntry({
        startDate: '2026-12-12', endDate: '2026-12-13', displayDate: '12-13/12',
        title: 'Αχαϊα: Χελμός, «Χτένια» νέα', club: 'ΕΠΟΣ Φυλής',
        url: 'https://eposfilis.gr/event/11-13-12-chelmos/', difficulty: '3, 4'
      }, '2026-11-26T10:00:00.000Z')
    ]
  };
  const cleanCurrent = [{
    startDate: '2026-12-12', endDate: '2026-12-13', displayDate: '12-13/12',
    title: 'Αχαϊα: Χελμός, «Χτένια» νέα', club: 'ΕΠΟΣ Φυλής',
    url: 'https://eposfilis.gr/event/11-13-12-chelmos/', difficulty: '3, 4'
  }];
  const recovered = diffEventsWithLedger({
    currentEvents: cleanCurrent,
    ledger: dupLedger,
    statusData: { lastUpdated: '2026-11-26T21:00:00.000Z', logs: [{ club: 'ΕΠΟΣ Φυλής', status: 'success', details: 'Parsed 1 events' }] },
    todayStr: '2026-11-27',
    nowIso: '2026-11-27T00:00:00.000Z'
  });
  assert.equal(recovered.addedEvents.length, 0);
  assert.equal(recovered.changedEvents.length, 0);
  assert.equal(recovered.cancelledEvents.length, 0);
  assert.equal(recovered.nextLedger.events.length, 1);
  assert.equal(recovered.hasSilentLedgerChanges, true);
});

test('regression: buildAdminHealthAlert guards stale clubHealth, push scoping, no-cache data_loss impact, and multi-club invalid dates', () => {
  assert.equal(isValidCalendarDate('2026-02-31'), false);
  assert.equal(isValidCalendarDate('2026-02-28'), true);

  // Stale clubHealth (mismatched timestamp) must NOT override healthy statusData
  const staleAlert = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-25T11:17:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'transient_fallback', consecutiveFetchFallbacks: 1, lastError: 'HTTP 403', preservedCount: 10 } }
    },
    statusData: {
      lastUpdated: '2026-11-27T11:17:00.000Z',
      logs: [{ club: 'ΠΟΑ', status: 'success', details: 'Parsed 10 events' }]
    },
    isScrapeRun: true
  });
  assert.equal(staleAlert, null);

  // Push run with broadcast error must NOT inherit old transient_fallback title from clubHealth
  const pushBroadcastAlert = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T11:17:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'transient_fallback', consecutiveFetchFallbacks: 1, lastError: 'HTTP 403', preservedCount: 10 } }
    },
    statusData: { lastUpdated: '2026-11-27T11:17:00.000Z', logs: [] },
    broadcastErrors: [{ channel: 'Buttondown Email', message: 'HTTP 429' }],
    isScrapeRun: false
  });
  assert.ok(pushBroadcastAlert && pushBroadcastAlert[0].includes('Σφάλμα Αποστολής Ειδοποιήσεων'));
  assert.ok(!pushBroadcastAlert[0].includes('Προσωρινό Μπλοκάρισμα'));

  // data_loss with preservedCount: 0 must truthfully warn no cache was available
  const noCacheAlert = buildAdminHealthAlert({
    clubHealth: {
      clubs: { 'ΦΟΝΙ': { status: 'data_loss', lastError: 'HTTP 500', preservedCount: 0 } }
    },
    isScrapeRun: true
  });
  assert.ok(noCacheAlert[0].includes('δεν υπήρχε διαθέσιμο cache'));

  // detectAnomalies must flag invalid dates across ALL clubs (not break after first)
  const dir = makeTempDir();
  try {
    const paths = {
      eventsFile: path.join(dir, 'events.json'),
      baselineFile: path.join(dir, 'health-baseline.json'),
      statusFile: path.join(dir, 'status.json'),
      clubHealthFile: path.join(dir, 'club-health.json'),
      linkConfigFile: path.join(dir, 'link-config.json'),
      linksMdFile: path.join(dir, 'LINKS.md'),
      currentHashesFile: path.join(dir, 'content-hashes.json'),
      oldHashesFile: path.join(dir, 'content-hashes-old.json'),
      reportFile: path.join(dir, 'anomaly_report.md')
    };
    fs.writeFileSync(paths.linkConfigFile, JSON.stringify({ 'ΠΟΑ': ['https://poa.gr/'], 'ΦΟΠ': ['https://fop.gr/'] }));
    fs.writeFileSync(paths.baselineFile, JSON.stringify({}));
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-27T11:17:00.000Z',
      logs: [
        { club: 'ΠΟΑ', status: 'success', parsedCount: 1, preservedCount: 0, fetchFailed: false },
        { club: 'ΦΟΠ', status: 'success', parsedCount: 1, preservedCount: 0, fetchFailed: false }
      ]
    }));
    fs.writeFileSync(paths.eventsFile, JSON.stringify([
      { startDate: '2026-02-31', title: 'Bad POA', club: 'ΠΟΑ', url: 'https://poa.gr/' },
      { startDate: 'bad-date', title: 'Bad FOP', club: 'ΦΟΠ', url: 'https://fop.gr/' }
    ]));
    const r = detectAnomalies({ paths, todayStr: '2026-11-27' });
    assert.equal(r.clubHealth.clubs['ΠΟΑ'].status, 'parser_error');
    assert.equal(r.clubHealth.clubs['ΦΟΠ'].status, 'parser_error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('end-to-end runNotifications: --dry-run has zero disk side effects; total failure preserves ledger; partial failure advances ledger and alerts admin', async () => {
  const dir = makeTempDir();
  try {
    const paths = {
      eventsFile: path.join(dir, 'events.json'),
      ledgerFile: path.join(dir, 'notified-events.json'),
      statusFile: path.join(dir, 'status.json'),
      clubHealthFile: path.join(dir, 'club-health.json'),
      anomalyReportFile: path.join(dir, 'anomaly_report.md'),
      localSummaryFile: path.join(dir, 'last_sync_summary.md')
    };

    const existingEv = {
      startDate: '2027-01-10', endDate: '2027-01-10', displayDate: '10/1',
      title: 'Πάρνηθα', club: 'ΕΠΟΣ Φυλής', url: 'https://eposfilis.gr/event/1/', difficulty: '1'
    };
    const newEv = {
      startDate: '2027-01-17', endDate: '2027-01-17', displayDate: '17/1',
      title: 'Νότιος Υμηττός', club: 'ΕΠΟΣ Φυλής', url: 'https://eposfilis.gr/event/2/', difficulty: '1+'
    };

    const initialLedgerObj = {
      version: 1,
      updatedAt: '2026-11-26T00:00:00.000Z',
      events: [createLedgerEntry(existingEv, '2026-11-26T00:00:00.000Z')]
    };
    fs.writeFileSync(paths.eventsFile, JSON.stringify([existingEv, newEv]));
    fs.writeFileSync(paths.ledgerFile, JSON.stringify(initialLedgerObj));
    fs.writeFileSync(paths.statusFile, JSON.stringify({
      lastUpdated: '2026-11-27T11:17:00.000Z',
      logs: [{ club: 'ΕΠΟΣ Φυλής', status: 'success', parsedCount: 2, preservedCount: 0, fetchFailed: false }]
    }));
    fs.writeFileSync(paths.clubHealthFile, JSON.stringify({
      version: 1,
      lastProcessedStatusTimestamp: '2026-11-27T11:17:00.000Z',
      clubs: { 'ΕΠΟΣ Φυλής': { status: 'healthy' } }
    }));

    const baseEnv = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_ADMIN_CHAT_ID: 'admin-123',
      TELEGRAM_CHANNEL_ID: '@test_channel',
      BUTTONDOWN_API_KEY: 'bd-key',
      IS_SCRAPE_RUN: 'true',
      GITHUB_RUN_URL: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/999'
    };

    // 1. --dry-run writes ZERO files and makes ZERO network calls
    let calls = 0;
    const dryRes = await runNotifications({
      paths,
      env: baseEnv,
      argv: ['--dry-run'],
      todayStr: '2026-11-27',
      fetchImpl: async () => { calls++; throw new Error('Network should not be called in dry-run'); }
    });
    assert.equal(calls, 0);
    assert.equal(dryRes.ledgerPersisted, false);
    assert.equal(fs.existsSync(paths.localSummaryFile), false, '--dry-run must not write last_sync_summary.md');
    assert.equal(JSON.parse(fs.readFileSync(paths.ledgerFile, 'utf-8')).events.length, 1);

    // 2. Both public channels fail (Telegram channel 500 + Buttondown 500) -> ledger MUST NOT advance, admin alert sent!
    const requestsFail = [];
    const failRes = await runNotifications({
      paths,
      env: baseEnv,
      argv: [],
      todayStr: '2026-11-27',
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body);
        requestsFail.push({ url, chatId: body.chat_id, text: body.text });
        if (url.includes('buttondown.com') || body.chat_id === '@test_channel') {
          return { ok: false, status: 500, text: async () => 'Upstream Error' };
        }
        return { ok: true, status: 200, text: async () => '{}' };
      }
    });
    assert.equal(failRes.broadcastErrors.length, 2);
    assert.equal(failRes.ledgerPersisted, false, 'Ledger must NOT advance when all public channels fail');
    assert.equal(failRes.adminHealthAlertSent, true);
    assert.equal(JSON.parse(fs.readFileSync(paths.ledgerFile, 'utf-8')).events.length, 1);
    assert.ok(requestsFail.some(r => r.chatId === 'admin-123' && r.text.includes('Σφάλμα Αποστολής Ειδοποιήσεων')));

    // 3. Partial failure (Telegram channel succeeds, Buttondown returns 429) -> ledger DOES advance (avoid double Telegram send) + admin alerted!
    const partialRes = await runNotifications({
      paths,
      env: baseEnv,
      argv: [],
      todayStr: '2026-11-27',
      fetchImpl: async (url) => {
        if (url.includes('buttondown.com')) {
          return { ok: false, status: 429, text: async () => 'Rate limited' };
        }
        return { ok: true, status: 200, text: async () => '{}' };
      }
    });
    assert.equal(partialRes.broadcastErrors.length, 1);
    assert.equal(partialRes.ledgerPersisted, true, 'Ledger must advance once a public channel succeeded to prevent duplicates');
    assert.equal(partialRes.adminHealthAlertSent, true);
    assert.equal(JSON.parse(fs.readFileSync(paths.ledgerFile, 'utf-8')).events.length, 2);

    // 4. Immediate re-run -> 0 updates, 0 channel broadcasts (idempotent!)
    const rerunReqs = [];
    const rerunRes = await runNotifications({
      paths,
      env: baseEnv,
      argv: [],
      todayStr: '2026-11-27',
      fetchImpl: async (url) => {
        rerunReqs.push(url);
        return { ok: true, status: 200, text: async () => '{}' };
      }
    });
    assert.equal(rerunRes.hasUserUpdates, false);
    assert.equal(rerunReqs.length, 0);

    // 5. Regular non-scrape push with 0 updates -> 0 Telegram/Email requests (no spam)
    const normalPushReqs = [];
    const normalPushRes = await runNotifications({
      paths,
      env: { ...baseEnv, IS_SCRAPE_RUN: 'false', IS_SELF_HEAL_PUSH: 'false' },
      argv: [],
      todayStr: '2026-11-27',
      fetchImpl: async (url) => {
        normalPushReqs.push(url);
        return { ok: true, status: 200, text: async () => '{}' };
      }
    });
    assert.equal(normalPushRes.hasUserUpdates, false);
    assert.equal(normalPushRes.adminHealthAlertSent, false);
    assert.equal(normalPushReqs.length, 0);

    // 6. Local self-heal push with 0 updates -> 0 public broadcasts, 1 Admin Telegram confirmation!
    const selfHealReqs = [];
    const selfHealRes = await runNotifications({
      paths,
      env: { ...baseEnv, IS_SCRAPE_RUN: 'false', IS_SELF_HEAL_PUSH: 'true' },
      argv: [],
      todayStr: '2026-11-27',
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body);
        selfHealReqs.push({ url, chatId: body.chat_id, text: body.text });
        return { ok: true, status: 200, text: async () => '{}' };
      }
    });
    assert.equal(selfHealRes.hasUserUpdates, false);
    assert.equal(selfHealRes.adminHealthAlertSent, true);
    assert.equal(selfHealReqs.length, 1);
    assert.equal(selfHealReqs[0].chatId, 'admin-123');
    assert.ok(selfHealReqs[0].text.includes('Τοπική Επιδιόρθωση (Self-Heal) Ολοκληρώθηκε'));
    assert.ok(selfHealReqs[0].text.includes('deploy κανονικά'));
    assert.ok(selfHealReqs[0].text.includes('Δεν υπήρχαν νέες αλλαγές προς αποστολή'));
    assert.ok(selfHealReqs[0].text.includes('actions/runs/999'));
    assert.ok(!selfHealReqs[0].text.includes('**'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('regression: buildAdminHealthAlert handles isSelfHealPush confirmations/errors and isolates test-alert issueUrl from real alerts', () => {
  // 1. Self-heal push with 0 updates -> concise Admin confirmation
  const selfHealQuiet = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T14:45:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'healthy' }, 'ΦΟΠ': { status: 'healthy' } }
    },
    statusData: { lastUpdated: '2026-11-27T14:45:00.000Z', logs: [] },
    subscriberSummary: null,
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/501',
    healthyClubsCount: 8,
    totalClubsCount: 8,
    isScrapeRun: false,
    isSelfHealPush: true
  });
  assert.ok(selfHealQuiet && selfHealQuiet.length === 1);
  assert.ok(selfHealQuiet[0].includes('Τοπική Επιδιόρθωση (Self-Heal) Ολοκληρώθηκε'));
  assert.ok(selfHealQuiet[0].includes('8/8'));
  assert.ok(selfHealQuiet[0].includes('deploy κανονικά'));
  assert.ok(selfHealQuiet[0].includes('Δεν υπήρχαν νέες αλλαγές προς αποστολή'));
  assert.ok(selfHealQuiet[0].includes('GitHub Actions Run'));
  assert.ok(!selfHealQuiet[0].includes('**'));

  // 2. Self-heal push with subscriber updates -> includes subscriber summary
  const selfHealWithUpdates = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T14:45:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'healthy' } }
    },
    statusData: { lastUpdated: '2026-11-27T14:45:00.000Z', logs: [] },
    subscriberSummary: 'Στάλθηκαν: +2 νέες (ΠΟΑ)',
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/502',
    healthyClubsCount: 8,
    totalClubsCount: 8,
    isScrapeRun: false,
    isSelfHealPush: true
  });
  assert.ok(selfHealWithUpdates && selfHealWithUpdates[0].includes('Στάλθηκαν: +2 νέες (ΠΟΑ)'));

  // 3. Self-heal push with broadcast error -> emits delivery error alert, NOT green confirmation
  const selfHealBroadcastErr = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T14:45:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'healthy' } }
    },
    statusData: { lastUpdated: '2026-11-27T14:45:00.000Z', logs: [] },
    broadcastErrors: [{ channel: 'Buttondown Email', message: 'HTTP 500' }],
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/503',
    isScrapeRun: false,
    isSelfHealPush: true
  });
  assert.ok(selfHealBroadcastErr[0].includes('Σφάλμα Αποστολής Ειδοποιήσεων'));
  assert.ok(!selfHealBroadcastErr[0].includes('Ολοκληρώθηκε'));

  // 4. Self-heal push with a still-degraded club in clubHealth -> emits real issue alert, NOT false green confirmation
  const selfHealStillDegraded = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T14:45:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'critical_fallback', consecutiveFetchFallbacks: 2, lastError: 'HTTP 403', preservedCount: 16 } }
    },
    statusData: { lastUpdated: '2026-11-27T14:45:00.000Z', logs: [] },
    isScrapeRun: false,
    isSelfHealPush: true
  });
  assert.ok(selfHealStillDegraded[0].includes('Επίμονο Μπλοκάρισμα IP'));
  assert.ok(!selfHealStillDegraded[0].includes('Ολοκληρώθηκε'));

  // 5. Simultaneous isTestAlert=true AND hasIssues=true -> real club-health alert MUST NOT link to test-alert issueUrl!
  const testAlertWithRealIssue = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T11:17:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'transient_fallback', consecutiveFetchFallbacks: 1, lastError: 'HTTP 403', preservedCount: 16 } }
    },
    statusData: { lastUpdated: '2026-11-27T11:17:00.000Z', logs: [] },
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/600',
    issueUrl: 'https://github.com/kostis-kounadis/Mount-Athens/issues/99',
    issueAction: 'created',
    isScrapeRun: true,
    isTestAlert: true
  });
  assert.ok(testAlertWithRealIssue[0].includes('Προσωρινό Μπλοκάρισμα (1η φορά)'));
  assert.ok(!testAlertWithRealIssue[0].includes('issues/99'), 'Test-alert issue URL must NOT be attached to a real club-health alert');
  assert.ok(!testAlertWithRealIssue[0].includes('GitHub Issue #99'));
  assert.ok(testAlertWithRealIssue[0].includes('actions/runs/600'), 'Run URL must still be attached');

  // 6. Pure test alert (isTestAlert=true, hasIssues=false) -> DOES attach the test-alert issueUrl
  const pureTestAlert = buildAdminHealthAlert({
    clubHealth: {
      lastProcessedStatusTimestamp: '2026-11-27T11:17:00.000Z',
      clubs: { 'ΠΟΑ': { status: 'healthy' } }
    },
    statusData: { lastUpdated: '2026-11-27T11:17:00.000Z', logs: [] },
    runUrl: 'https://github.com/kostis-kounadis/Mount-Athens/actions/runs/601',
    issueUrl: 'https://github.com/kostis-kounadis/Mount-Athens/issues/100',
    issueAction: 'created',
    isScrapeRun: true,
    isTestAlert: true
  });
  assert.ok(pureTestAlert[0].includes('Δοκιμαστική Ειδοποίηση (Test Alert)'));
  assert.ok(pureTestAlert[0].includes('issues/100'));
  assert.ok(pureTestAlert[0].includes('GitHub Issue #100'));
  assert.ok(pureTestAlert[0].includes('actions/runs/601'));
});
