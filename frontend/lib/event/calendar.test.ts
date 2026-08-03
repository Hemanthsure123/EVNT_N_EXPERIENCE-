import { describe, expect, it } from 'vitest';
import {
  googleCalendarUrl,
  icsFilename,
  outlookCalendarUrl,
  toCalendarEvent,
  toIcs,
  yahooCalendarUrl,
} from './calendar';
import type { EventDetail } from '@/lib/api/types';

const EVENT: EventDetail = {
  id: 'evt-1',
  organization_id: 'org-1',
  organization_name: 'Groove Collective',
  title: 'Sunburn Jazz Night',
  description: 'An evening of live jazz.',
  venue: 'The Hall, Level 2',
  city: 'Mumbai',
  starts_at: '2026-12-01T13:30:00Z',
  ends_at: '2026-12-01T17:00:00Z',
  status: 'live',
  poster_url: '',
  from_price: 49900,
  tickets_available: 100,
  version: 1,
  created_at: '2026-07-01T00:00:00Z',
  // Blank, which is the realistic default: an organizer who filled none of
  // these in. The calendar export must work from the columns it always has.
  short_description: '',
  duration_minutes: null,
  language: '',
  age_restriction: '',
  accessibility_notes: '',
  seo_title: '',
  seo_description: '',
};

const URL_ = 'https://curatix.example/events/evt-1';

describe('toCalendarEvent', () => {
  it('uses the organizer’s end time when there is one', () => {
    const calendar = toCalendarEvent(EVENT, URL_);
    expect(calendar.endIsAssumed).toBe(false);
    expect(calendar.end.toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });

  it('assumes two hours when the end is missing, and SAYS so', () => {
    // The disclosure is the point: an unstated duration written silently into
    // someone's diary is a number they will plan an evening around.
    const calendar = toCalendarEvent({ ...EVENT, ends_at: null }, URL_);
    expect(calendar.endIsAssumed).toBe(true);
    expect(calendar.end.getTime() - calendar.start.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(calendar.description).toMatch(/assumes two hours/i);
  });

  it('joins venue and city into one location', () => {
    expect(toCalendarEvent(EVENT, URL_).location).toBe('The Hall, Level 2, Mumbai');
  });
});

describe('toIcs', () => {
  it('escapes the separators RFC 5545 reserves', () => {
    // A venue containing a comma silently truncates LOCATION without this.
    const ics = toIcs(toCalendarEvent(EVENT, URL_), 'evt-1');
    expect(ics).toContain('LOCATION:The Hall\\, Level 2\\, Mumbai');
  });

  it('uses CRLF line endings, which Outlook requires', () => {
    expect(toIcs(toCalendarEvent(EVENT, URL_), 'evt-1')).toContain('\r\n');
  });

  it('carries the required VEVENT fields', () => {
    const ics = toIcs(toCalendarEvent(EVENT, URL_), 'evt-1');
    for (const field of [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:',
      'DTSTART:',
      'DTEND:',
      'SUMMARY:',
    ]) {
      expect(ics).toContain(field);
    }
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('stamps times as UTC in the one format both consumers accept', () => {
    expect(toIcs(toCalendarEvent(EVENT, URL_), 'evt-1')).toContain('DTSTART:20261201T133000Z');
  });

  it('escapes newlines in the description rather than terminating the property', () => {
    const ics = toIcs(toCalendarEvent({ ...EVENT, description: 'Line one\nLine two' }, URL_), 'x');
    expect(ics).toContain('Line one\\nLine two');
  });
});

describe('googleCalendarUrl', () => {
  it('encodes a start/end range Google accepts', () => {
    const url = googleCalendarUrl(toCalendarEvent(EVENT, URL_));
    expect(url).toContain('dates=20261201T133000Z%2F20261201T170000Z');
    expect(url).toContain('text=Sunburn+Jazz+Night');
  });
});

describe('icsFilename', () => {
  it('slugs the title and stays filesystem-safe', () => {
    expect(icsFilename('Sunburn Jazz Night!')).toBe('sunburn-jazz-night.ics');
  });

  it('falls back rather than producing a bare extension', () => {
    expect(icsFilename('!!!')).toBe('event.ics');
  });
});

/**
 * RFC 5545 line folding — the defect that made `.ics` "not work".
 *
 * Google Calendar tolerates an over-long content line; Apple Calendar and some
 * Outlook builds reject the file or truncate the entry, with no error the user
 * can act on. So the symptom was "Add to calendar does nothing" for everyone
 * not on Google, which is exactly how it was reported.
 */
describe('ICS conformance', () => {
  const longEvent: EventDetail = {
    ...EVENT,
    description:
      'An evening of stand-up comedy featuring the best of the Mumbai circuit. ' +
      'Doors open at 7pm, the show starts at 8pm sharp, and latecomers are seated ' +
      'only during the interval. Please carry a photo ID matching your booking.',
  };

  const contentLines = (ics: string) => ics.split('\r\n');

  it('folds every line to 75 octets or fewer', () => {
    const ics = toIcs(toCalendarEvent(longEvent, 'https://e.test/events/evt-1'), 'evt-1');

    const tooLong = contentLines(ics).filter(
      (line) => new TextEncoder().encode(line).length > 75,
    );
    expect(tooLong).toEqual([]);
  });

  it('folds with a leading space, which is what makes it unfolding-safe', () => {
    const ics = toIcs(toCalendarEvent(longEvent, 'https://e.test/events/evt-1'), 'evt-1');

    // Unfolding is defined as removing CRLF + the single following space.
    // Round-tripping must give back the original value.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('the show starts at 8pm sharp');
  });

  it('never splits a multi-byte character', () => {
    // A half-written UTF-8 sequence is a corrupt file — worse than the long
    // line folding exists to fix.
    const ics = toIcs(
      toCalendarEvent({ ...EVENT, description: '🎤'.repeat(60) }, 'https://e.test/x'),
      'evt-1',
    );

    expect(ics).not.toContain('\uFFFD'); // the replacement character
    expect(ics.replace(/\r\n /g, '')).toContain('🎤'.repeat(60));
  });

  it('keeps short lines untouched', () => {
    const ics = toIcs(toCalendarEvent(EVENT, 'https://e.test/x'), 'evt-1');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
  });
});

describe('the other three targets', () => {
  const calendar = toCalendarEvent(EVENT, 'https://e.test/events/evt-1');

  it('sends Outlook an ISO instant, and distinguishes personal from work', () => {
    const personal = outlookCalendarUrl(calendar, 'personal');
    const work = outlookCalendarUrl(calendar, 'work');

    expect(personal).toContain('outlook.live.com');
    expect(work).toContain('outlook.office.com');
    // A work account is signed out of the personal host entirely, which is
    // why one link cannot serve both.
    expect(personal).toContain(encodeURIComponent('2026-12-01T13:30:00.000Z'));
  });

  it('gives Yahoo a DURATION, because it ignores an end time', () => {
    // 13:30 -> 17:00 is 3h30m. Passing `et` alone silently makes it one hour.
    expect(yahooCalendarUrl(calendar)).toContain('dur=0330');
  });

  it('falls back to an end time when the duration cannot be expressed', () => {
    const marathon = toCalendarEvent(
      { ...EVENT, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-06T00:00:00Z' },
      'https://e.test/x',
    );
    const url = yahooCalendarUrl(marathon);

    expect(url).not.toContain('dur=');
    expect(url).toContain('et=');
  });

  it('puts a directions link in the body, built from the venue text', () => {
    // NOT from coordinates: they are nullable, and (0, 0) is a real place in
    // the Atlantic, so a fallback would be a confident wrong pin.
    expect(calendar.description).toContain('google.com/maps/search/');
    expect(calendar.description).toContain(encodeURIComponent('The Hall, Level 2, Mumbai'));
  });
});
