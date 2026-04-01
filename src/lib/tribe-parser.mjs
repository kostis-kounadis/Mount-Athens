import * as cheerio from 'cheerio';

/**
 * Directly parse Tribe Events API JSON into our event schema.
 * No AI/Gemini needed -- this is pure structured data mapping.
 *
 * @param {string} jsonStr - Raw JSON from the Tribe Events REST API
 * @param {object} club - Club config object
 * @returns {object[]} - Array of events in our schema format
 */
export function parseTribeEventsDirectly(jsonStr, club) {
  try {
    const data = JSON.parse(jsonStr);
    const events = data.events || [];

    if (events.length === 0) {
      console.log(`[tribe-parser] No events from Tribe API for ${club.id}`);
      return [];
    }

    const now = new Date().toISOString();

    return events.map(event => {
      // Extract date from start_date (format: "2026-04-05 08:00:00")
      const dateStr = (event.start_date || '').split(' ')[0];
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return null; // Skip events without valid dates
      }

      // Clean HTML from title and description
      const title = stripHTML(event.title || '');
      const description = stripHTML(event.description || '').slice(0, 500);

      // Build slug from title
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);

      // Extract venue info
      const venue = event.venue;
      const meetingPoint = venue
        ? [venue.venue, venue.address, venue.city].filter(Boolean).join(', ')
        : null;

      // Extract start time (HH:MM)
      const timeParts = (event.start_date || '').split(' ');
      const meetingTime = timeParts[1] ? timeParts[1].slice(0, 5) : null;

      // Try to infer event type from title/description
      const eventType = inferEventType(title + ' ' + description);

      return {
        id: `${club.id}-${dateStr}-${slug}`,
        date: dateStr,
        club_id: club.id,
        club_name: club.name_en,
        event_title: title,
        event_type: eventType,
        difficulty: null,
        difficulty_label: null,
        duration_hours: null,
        elevation_gain_m: null,
        meeting_point: meetingPoint || null,
        meeting_time: meetingTime !== '00:00' ? meetingTime : null,
        description: description || null,
        original_url: event.url || `${club.url}/events`,
        scraped_at: now,
      };
    }).filter(Boolean); // Remove nulls
  } catch (err) {
    console.error(`[tribe-parser] Failed to parse for ${club.id}: ${err.message}`);
    return [];
  }
}

/**
 * Strip HTML tags from a string.
 */
function stripHTML(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.text().replace(/\s+/g, ' ').trim();
}

/**
 * Infer event type from text content.
 */
function inferEventType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('αναρρίχη') || lower.includes('climb')) return 'climbing';
  if (lower.includes('ορειβα') || lower.includes('mountaineer')) return 'mountaineering';
  if (lower.includes('trek') || lower.includes('πεζοπορ')) return 'trekking';
  if (lower.includes('ski') || lower.includes('χιον')) return 'skiing';
  if (lower.includes('trail') || lower.includes('τρέξ')) return 'trail-running';
  if (lower.includes('hik') || lower.includes('εξόρμηση') || lower.includes('πορεία')) return 'hiking';
  return 'other';
}
