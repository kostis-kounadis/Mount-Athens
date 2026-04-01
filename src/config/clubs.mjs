/**
 * Club configurations for scraping.
 *
 * source_type:
 *   'html' = fetch HTML page + extract text with cheerio, then parse with Gemini
 *   'tribe_api' = fetch from WordPress Tribe Events REST API (returns JSON), parse directly -- NO AI needed
 *
 * schedule_day:
 *   0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 *   Each club is assigned a day for its daily rotation to stay within Gemini free-tier limits.
 */
export const clubs = [
  {
    id: 'poa',
    name: 'ΠΟΑ',
    name_en: 'POA',
    url: 'https://poa.gr',
    events_path: '/index.php/programma/',
    source_type: 'html',
    content_selector: '.entry-content, .page-content, article, main, .content-area, body',
    color: '#dc2626',
    schedule_day: 1, // Monday
  },
  {
    id: 'aos',
    name: 'ΑΟΣ',
    name_en: 'AOS',
    url: 'https://aos.gr',
    events_path: '/programma-exormiseon-ianouarios-2026-septemvrios-2026/',
    source_type: 'html',
    content_selector: '.entry-content, article, main, body',
    color: '#059669',
    schedule_day: 2, // Tuesday
  },
  {
    id: 'epos-filis',
    name: 'ΕΠΟΣ Φυλής',
    name_en: 'EPOS Filis',
    url: 'https://eposfilis.gr',
    events_path: '/wp-json/tribe/events/v1/events?per_page=20&start_date=now',
    source_type: 'tribe_api',
    content_selector: '',
    color: '#d97706',
    schedule_day: 3, // Wednesday -- no Gemini needed
  },
  {
    id: 'eos-acharnon',
    name: 'ΕΟΣ Αχαρνών',
    name_en: 'EOS Acharnon',
    url: 'https://eosacharnon.gr',
    events_path: '/',
    // Also try Tribe API: /wp-json/tribe/events/v1/events
    tribe_api_fallback: '/wp-json/tribe/events/v1/events?per_page=20&start_date=now',
    source_type: 'html',
    content_selector: '.tribe-events-list, .tribe-common, .entry-content, article, main, body',
    color: '#2563eb',
    schedule_day: 4, // Thursday
  },
  {
    id: 'eosh',
    name: 'ΕΟΣΧ',
    name_en: 'EOSH',
    url: 'https://eosh.gr',
    events_path: '/wp/category/events/',
    source_type: 'html',
    content_selector: '.entry-content, .post-content, article, main, body',
    color: '#7c3aed',
    schedule_day: 5, // Friday
  },
];

/**
 * Get the club scheduled for today's rotation.
 * Returns null on weekends (Sat/Sun).
 */
export function getTodaysClub() {
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun ... 6=Sat
  return clubs.find(c => c.schedule_day === dayOfWeek) || null;
}

/**
 * Find a club by ID.
 */
export function getClubById(id) {
  return clubs.find(c => c.id === id) || null;
}
