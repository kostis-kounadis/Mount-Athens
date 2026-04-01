/**
 * Event JSON schema definition and validation utilities.
 */

/**
 * Known Greek difficulty abbreviations mapped to English labels.
 */
export const DIFFICULTY_MAP = {
  'ΒΔ': { code: 'BD', label: 'Easy' },
  'ΥΔ': { code: 'YD', label: 'Moderate' },
  'ΩΠ': { code: 'OP', label: 'Mountaineering' },
  'ΑΝ': { code: 'AN', label: 'Climbing' },
  'ΟΠ': { code: 'OP-T', label: 'Trekking' },
};

/**
 * Allowed event_type values.
 */
export const EVENT_TYPES = [
  'hiking',
  'mountaineering',
  'climbing',
  'trekking',
  'skiing',
  'trail-running',
  'other',
];

/**
 * Valid club IDs from clubs.json.
 */
export const VALID_CLUB_IDS = [
  'eos-acharnon',
  'poa',
  'aos',
  'epos-filis',
  'eosh',
];

/**
 * Validates a single event object against the expected schema.
 * Returns an object with { valid: boolean, errors: string[] }.
 *
 * @param {object} event - The event object to validate.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEvent(event) {
  const errors = [];

  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['Event must be a non-null object'] };
  }

  // Required string fields
  const requiredStrings = ['id', 'date', 'club_id', 'club_name', 'event_title'];
  for (const field of requiredStrings) {
    if (typeof event[field] !== 'string' || event[field].trim() === '') {
      errors.push(`Missing or invalid required field: ${field}`);
    }
  }

  // Validate date format (ISO 8601 date: YYYY-MM-DD)
  if (typeof event.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    errors.push(`Invalid date format: ${event.date} (expected YYYY-MM-DD)`);
  }

  // Validate club_id
  if (typeof event.club_id === 'string' && !VALID_CLUB_IDS.includes(event.club_id)) {
    errors.push(`Unknown club_id: ${event.club_id}`);
  }

  // Validate event_type if present
  if (event.event_type != null && !EVENT_TYPES.includes(event.event_type)) {
    errors.push(`Unknown event_type: ${event.event_type}`);
  }

  // Validate numeric fields if present
  if (event.duration_hours != null && (typeof event.duration_hours !== 'number' || event.duration_hours < 0)) {
    errors.push(`Invalid duration_hours: ${event.duration_hours}`);
  }

  if (event.elevation_gain_m != null && (typeof event.elevation_gain_m !== 'number' || event.elevation_gain_m < 0)) {
    errors.push(`Invalid elevation_gain_m: ${event.elevation_gain_m}`);
  }

  // Validate scraped_at if present
  if (event.scraped_at != null && typeof event.scraped_at === 'string') {
    const d = new Date(event.scraped_at);
    if (isNaN(d.getTime())) {
      errors.push(`Invalid scraped_at timestamp: ${event.scraped_at}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates an array of events. Returns only the valid ones,
 * logging warnings for invalid entries.
 *
 * @param {object[]} events - Array of event objects.
 * @returns {object[]} - Array of valid event objects.
 */
export function filterValidEvents(events) {
  if (!Array.isArray(events)) {
    console.warn('filterValidEvents: input is not an array');
    return [];
  }

  const valid = [];
  for (const event of events) {
    const result = validateEvent(event);
    if (result.valid) {
      valid.push(event);
    } else {
      console.warn(`Skipping invalid event: ${JSON.stringify(result.errors)}`);
    }
  }
  return valid;
}

/**
 * Deduplicates events by their id field, keeping the first occurrence.
 *
 * @param {object[]} events - Array of event objects.
 * @returns {object[]}
 */
export function deduplicateEvents(events) {
  const seen = new Set();
  const unique = [];
  for (const event of events) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      unique.push(event);
    }
  }
  return unique;
}
