import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, filterValidEvents, deduplicateEvents, DIFFICULTY_MAP } from '../schema.mjs';

describe('validateEvent', () => {
  const validEvent = {
    id: 'eos-acharnon-2026-04-05-parnitha',
    date: '2026-04-05',
    club_id: 'eos-acharnon',
    club_name: 'EOS Acharnon',
    event_title: 'Parnitha - Bafi Refuge',
    event_type: 'hiking',
    difficulty: 'BD',
    difficulty_label: 'Easy',
    duration_hours: 5,
    elevation_gain_m: 600,
    meeting_point: null,
    meeting_time: null,
    description: 'Spring hike to Bafi refuge',
    original_url: 'https://eosacharnon.gr/events/parnitha-bafi',
    scraped_at: '2026-04-01T03:00:00Z',
  };

  it('should accept a valid event', () => {
    const result = validateEvent(validEvent);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should reject null input', () => {
    const result = validateEvent(null);
    assert.equal(result.valid, false);
  });

  it('should reject missing required fields', () => {
    const result = validateEvent({ id: 'test' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should reject invalid date format', () => {
    const event = { ...validEvent, date: '05/04/2026' };
    const result = validateEvent(event);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('date format')));
  });

  it('should reject unknown club_id', () => {
    const event = { ...validEvent, club_id: 'unknown-club' };
    const result = validateEvent(event);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('club_id')));
  });

  it('should reject unknown event_type', () => {
    const event = { ...validEvent, event_type: 'swimming' };
    const result = validateEvent(event);
    assert.equal(result.valid, false);
  });

  it('should accept null optional fields', () => {
    const event = { ...validEvent, duration_hours: null, elevation_gain_m: null, event_type: null };
    const result = validateEvent(event);
    assert.equal(result.valid, true);
  });

  it('should reject negative duration_hours', () => {
    const event = { ...validEvent, duration_hours: -1 };
    const result = validateEvent(event);
    assert.equal(result.valid, false);
  });
});

describe('filterValidEvents', () => {
  it('should return empty array for non-array input', () => {
    assert.deepEqual(filterValidEvents('not an array'), []);
  });

  it('should filter out invalid events', () => {
    const events = [
      {
        id: 'test-1',
        date: '2026-04-05',
        club_id: 'eos-acharnon',
        club_name: 'Test',
        event_title: 'Test Event',
      },
      { id: 'bad' }, // invalid
    ];
    const result = filterValidEvents(events);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'test-1');
  });
});

describe('deduplicateEvents', () => {
  it('should remove duplicate events by id', () => {
    const events = [
      { id: 'a', date: '2026-04-05' },
      { id: 'b', date: '2026-04-06' },
      { id: 'a', date: '2026-04-05' }, // duplicate
    ];
    const result = deduplicateEvents(events);
    assert.equal(result.length, 2);
  });

  it('should keep first occurrence', () => {
    const events = [
      { id: 'a', value: 'first' },
      { id: 'a', value: 'second' },
    ];
    const result = deduplicateEvents(events);
    assert.equal(result[0].value, 'first');
  });
});

describe('DIFFICULTY_MAP', () => {
  it('should have expected Greek abbreviations', () => {
    assert.ok(DIFFICULTY_MAP['ΒΔ']);
    assert.ok(DIFFICULTY_MAP['ΥΔ']);
    assert.equal(DIFFICULTY_MAP['ΒΔ'].label, 'Easy');
    assert.equal(DIFFICULTY_MAP['ΥΔ'].label, 'Moderate');
  });
});
