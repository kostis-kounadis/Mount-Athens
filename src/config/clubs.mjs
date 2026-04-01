/**
 * Club configurations for scraping.
 */
export const clubs = [
  {
    id: 'eos-acharnon',
    name: 'ΕΟΣ Αχαρνών',
    name_en: 'EOS Acharnon',
    url: 'https://eosacharnon.gr',
    events_path: '/events',
    content_selector: '.entry-content, .events-list, article, .post-content, main',
    color: '#2563eb',
  },
  {
    id: 'poa',
    name: 'ΠΟΑ',
    name_en: 'POA',
    url: 'https://poa.gr',
    events_path: '/drastiriotites',
    content_selector: '.entry-content, .events-list, article, .post-content, main',
    color: '#dc2626',
  },
  {
    id: 'aos',
    name: 'ΑΟΣ',
    name_en: 'AOS',
    url: 'https://aos.gr',
    events_path: '/events',
    content_selector: '.entry-content, .events-list, article, .post-content, main',
    color: '#059669',
  },
  {
    id: 'epos-filis',
    name: 'ΕΠΟΣ Φυλής',
    name_en: 'EPOS Filis',
    url: 'https://eposfilis.gr',
    events_path: '/drastiriotites',
    content_selector: '.entry-content, .events-list, article, .post-content, main',
    color: '#d97706',
  },
  {
    id: 'eosh',
    name: 'ΕΟΣΧ',
    name_en: 'EOSH',
    url: 'https://eosh.gr/wp',
    events_path: '/events',
    content_selector: '.entry-content, .events-list, article, .post-content, main',
    color: '#7c3aed',
  },
];
