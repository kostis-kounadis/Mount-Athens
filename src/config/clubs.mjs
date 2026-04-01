/**
 * Club configurations for scraping.
 *
 * source_type:
 *   'html' = fetch HTML page + extract text with cheerio
 *   'tribe_api' = fetch from WordPress Tribe Events REST API (returns JSON)
 */
export const clubs = [
  {
    id: 'eos-acharnon',
    name: 'ΕΟΣ Αχαρνών',
    name_en: 'EOS Acharnon',
    url: 'https://eosacharnon.gr',
    events_path: '/',
    source_type: 'html',
    content_selector: '.tribe-events-list, .tribe-common, .entry-content, article, main, body',
    color: '#2563eb',
  },
  {
    id: 'poa',
    name: 'ΠΟΑ',
    name_en: 'POA',
    url: 'https://poa.gr',
    events_path: '/index.php/programma/',
    source_type: 'html',
    content_selector: '.entry-content, .page-content, article, main, .content-area, body',
    color: '#dc2626',
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
  },
];
