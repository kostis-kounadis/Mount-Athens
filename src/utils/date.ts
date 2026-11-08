// Format current date in Greek (Athens timezone)
export function getAthensFormattedDate(): string {
  try {
    const parts = new Intl.DateTimeFormat('el-GR', {
      timeZone: 'Europe/Athens',
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).formatToParts(new Date());

    const day = parts.find(p => p.type === 'weekday')?.value.toUpperCase() || '';
    const date = parts.find(p => p.type === 'day')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value.toUpperCase() || '';
    const year = parts.find(p => p.type === 'year')?.value || '';
    
    const rawDate = `${day}, ${date} ${month} ${year}`;
    
    // Strip Greek accents from uppercase letters for standard Greek typography
    return rawDate
      .replace(/Ά/g, 'Α')
      .replace(/Έ/g, 'Ε')
      .replace(/Ή/g, 'Η')
      .replace(/Ί/g, 'Ι')
      .replace(/Ό/g, 'Ο')
      .replace(/Ύ/g, 'Υ')
      .replace(/Ώ/g, 'Ω')
      .replace(/Ϋ/g, 'Υ')
      .replace(/Ϊ/g, 'Ι');
  } catch (e) {
    // Safe fallback
    return 'ΤΕΤΑΡΤΗ, 10 ΙΟΥΝΙΟΥ 2026';
  }
}
