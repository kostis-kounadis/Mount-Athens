/**
 * Mount Athens - Calendar UI
 * Fetches events from /api/events and renders a vertical calendar.
 */

const CLUB_COLORS = {
  'eos-acharnon': { bg: 'bg-blue-50', border: 'border-blue-400', text: 'text-blue-700', pill: 'bg-blue-100 text-blue-800' },
  'poa': { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', pill: 'bg-red-100 text-red-800' },
  'aos': { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-800' },
  'epos-filis': { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', pill: 'bg-amber-100 text-amber-800' },
  'eosh': { bg: 'bg-violet-50', border: 'border-violet-400', text: 'text-violet-700', pill: 'bg-violet-100 text-violet-800' },
};

const DIFFICULTY_BADGES = {
  'Easy': 'bg-green-100 text-green-800',
  'Moderate': 'bg-yellow-100 text-yellow-800',
  'Mountaineering': 'bg-orange-100 text-orange-800',
  'Climbing': 'bg-red-100 text-red-800',
  'Trekking': 'bg-blue-100 text-blue-800',
};

const DEFAULT_COLORS = { bg: 'bg-stone-50', border: 'border-stone-400', text: 'text-stone-700', pill: 'bg-stone-100 text-stone-800' };

let allEvents = [];
let activeFilters = new Set();

/**
 * Fetch events from the API, falling back to sample data for local dev.
 */
async function fetchEvents() {
  try {
    let response = await fetch('/api/events');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Update "last updated" timestamp
    if (data.updated_at) {
      document.getElementById('last-updated').textContent =
        new Date(data.updated_at).toLocaleString('en-GB', { timeZone: 'Europe/Athens' });
    }

    return data.events || [];
  } catch (err) {
    console.warn('API fetch failed, trying sample data:', err.message);
    try {
      const fallback = await fetch('/data/events-sample.json');
      if (fallback.ok) {
        const events = await fallback.json();
        document.getElementById('last-updated').textContent = 'Sample data';
        return events;
      }
    } catch (_) {
      // ignore
    }
    throw err;
  }
}

/**
 * Group events by date string.
 */
function groupByDate(events) {
  const groups = {};
  for (const event of events) {
    if (!groups[event.date]) {
      groups[event.date] = [];
    }
    groups[event.date].push(event);
  }
  // Sort dates ascending
  const sorted = Object.keys(groups).sort();
  return sorted.map(date => ({ date, events: groups[date] }));
}

/**
 * Format a date string like "Sat, 5 Apr 2026".
 */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Check if a date is today.
 */
function isToday(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

/**
 * Check if a date is in the past.
 */
function isPast(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  return dateStr < today;
}

/**
 * Render a single event card.
 */
function renderEventCard(event) {
  const colors = CLUB_COLORS[event.club_id] || DEFAULT_COLORS;
  const diffBadge = event.difficulty_label ? DIFFICULTY_BADGES[event.difficulty_label] || 'bg-stone-100 text-stone-700' : null;

  const metaParts = [];
  if (event.duration_hours) metaParts.push(`${event.duration_hours}h`);
  if (event.elevation_gain_m) metaParts.push(`${event.elevation_gain_m}m &#8599;`);
  if (event.meeting_time) metaParts.push(`Meet: ${event.meeting_time}`);

  const meetingPoint = event.meeting_point ? `<p class="text-xs text-stone-500 mt-1">&#128205; ${escapeHTML(event.meeting_point)}</p>` : '';

  return `
    <a href="${escapeHTML(event.original_url || '#')}" target="_blank" rel="noopener"
       class="block ${colors.bg} border-l-4 ${colors.border} rounded-r-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold ${colors.text} text-sm sm:text-base truncate">${escapeHTML(event.event_title)}</h3>
          <p class="text-xs ${colors.text} opacity-75 mt-0.5">${escapeHTML(event.club_name)}</p>
        </div>
        <div class="flex gap-1.5 flex-shrink-0">
          ${diffBadge ? `<span class="text-xs px-2 py-0.5 rounded-full font-medium ${diffBadge}">${escapeHTML(event.difficulty_label)}</span>` : ''}
          <span class="text-xs px-2 py-0.5 rounded-full font-medium ${colors.pill}">${escapeHTML(event.event_type || 'other')}</span>
        </div>
      </div>
      ${event.description ? `<p class="text-sm text-stone-600 mt-1.5">${escapeHTML(event.description)}</p>` : ''}
      ${metaParts.length > 0 ? `<p class="text-xs text-stone-500 mt-1">${metaParts.join(' &middot; ')}</p>` : ''}
      ${meetingPoint}
    </a>
  `;
}

/**
 * Render the full calendar.
 */
function renderCalendar(events) {
  const filtered = activeFilters.size > 0
    ? events.filter(e => activeFilters.has(e.club_id))
    : events;

  const groups = groupByDate(filtered);
  const calendarEl = document.getElementById('calendar');

  if (groups.length === 0) {
    calendarEl.classList.add('hidden');
    document.getElementById('empty').classList.remove('hidden');
    return;
  }

  document.getElementById('empty').classList.add('hidden');
  calendarEl.classList.remove('hidden');

  calendarEl.innerHTML = groups.map(group => {
    const past = isPast(group.date);
    const today = isToday(group.date);
    const dateClass = today ? 'text-mountain-700 font-bold' : past ? 'text-stone-400' : 'text-stone-700';
    const todayBadge = today ? '<span class="ml-2 text-xs bg-mountain-500 text-white px-2 py-0.5 rounded-full">Today</span>' : '';
    const containerClass = past ? 'opacity-60' : '';

    return `
      <div class="${containerClass}">
        <div class="flex items-center mb-2">
          <h2 class="text-lg font-semibold ${dateClass}">${formatDate(group.date)}</h2>
          ${todayBadge}
        </div>
        <div class="space-y-2 ml-0 sm:ml-4">
          ${group.events.map(renderEventCard).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render club filter pills.
 */
function renderFilters(events) {
  const clubs = new Map();
  for (const e of events) {
    if (!clubs.has(e.club_id)) {
      clubs.set(e.club_id, e.club_name);
    }
  }

  const filtersEl = document.getElementById('club-filters');

  // "All" button
  let html = `<button data-club="all" class="filter-pill px-3 py-1 rounded-full text-sm font-medium transition-colors bg-mountain-700 text-white">All</button>`;

  for (const [id, name] of clubs) {
    const colors = CLUB_COLORS[id] || DEFAULT_COLORS;
    html += `<button data-club="${escapeHTML(id)}" class="filter-pill px-3 py-1 rounded-full text-sm font-medium transition-colors ${colors.pill} opacity-70 hover:opacity-100">${escapeHTML(name)}</button>`;
  }

  filtersEl.innerHTML = html;

  // Attach click handlers
  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;

    const club = btn.dataset.club;
    if (club === 'all') {
      activeFilters.clear();
    } else {
      if (activeFilters.has(club)) {
        activeFilters.delete(club);
      } else {
        activeFilters.add(club);
      }
    }

    updateFilterStyles();
    renderCalendar(allEvents);
  });
}

/**
 * Update the visual state of filter pills.
 */
function updateFilterStyles() {
  const pills = document.querySelectorAll('.filter-pill');
  const allActive = activeFilters.size === 0;

  pills.forEach(pill => {
    const club = pill.dataset.club;
    if (club === 'all') {
      pill.classList.toggle('bg-mountain-700', allActive);
      pill.classList.toggle('text-white', allActive);
      pill.classList.toggle('bg-stone-200', !allActive);
      pill.classList.toggle('text-stone-600', !allActive);
    } else {
      const isActive = activeFilters.has(club);
      pill.classList.toggle('opacity-70', !isActive && !allActive);
      pill.classList.toggle('opacity-100', isActive || allActive);
      pill.classList.toggle('ring-2', isActive);
      pill.classList.toggle('ring-stone-400', isActive);
    }
  });
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Initialize the app.
 */
async function init() {
  try {
    allEvents = await fetchEvents();

    document.getElementById('loading').classList.add('hidden');

    if (allEvents.length === 0) {
      document.getElementById('empty').classList.remove('hidden');
      return;
    }

    renderFilters(allEvents);
    renderCalendar(allEvents);
  } catch (err) {
    console.error('Failed to load events:', err);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
  }
}

init();
