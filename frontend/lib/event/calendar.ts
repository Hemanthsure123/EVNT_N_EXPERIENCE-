import type { EventDetail } from '@/lib/api/types';

/**
 * "Add to calendar" — derived entirely from fields the platform maintains.
 *
 * ── WHY THIS ONE IS BUILDABLE WHEN MOST OF THE PAGE IS NOT ────────────────
 *
 * It needs a title, a place, a start and an end. All four are real columns.
 * Nothing here is inferred, rounded or invented — which is why it ships while
 * duration, age restriction, language and attendance do not.
 *
 * ── THE END TIME PROBLEM, AND HOW IT IS HANDLED HONESTLY ──────────────────
 *
 * `ends_at` is nullable. A calendar entry MUST have an end, so something has
 * to fill the gap — and the honest options are a default duration or nothing
 * at all.
 *
 * We use a two-hour default AND say so in the description text that lands in
 * the user's calendar. Silently writing a two-hour block would put a number in
 * someone's diary that the organizer never stated, and they would plan their
 * evening around it. Saying "end time not specified by the organizer" inside
 * the event body costs nothing and keeps the guess visible.
 *
 * ── FOUR OUTPUTS, ONE SOURCE ──────────────────────────────────────────────
 *
 * Google, Outlook Web and Yahoo each take a URL — no download, and on a phone
 * that is the difference between one tap and a file the OS does not know what
 * to do with. Apple Calendar, desktop Outlook and everything else consume the
 * `.ics` file, which is the actual interoperable standard.
 *
 * ── TIMES ARE ABSOLUTE INSTANTS, IN UTC ───────────────────────────────────
 *
 * `starts_at` is a timestamptz — a moment, not a wall-clock reading — so every
 * stamp here is UTC (`…Z`) and each client renders it in the viewer's own zone.
 * That is why there is no `VTIMEZONE` block: one would only be needed for a
 * FLOATING local time ("9am wherever you are"), which a ticketed event is not.
 * An IST-labelled DTSTART would additionally require shipping the full Asia/
 * Kolkata definition, and getting it wrong moves the entry by hours.
 *
 * RECURRENCE (`RRULE`) is deliberately absent: nothing in the schema records a
 * repeat, so any rule written here would be invented.
 */

/** When the organizer gave no end time. Stated in the calendar body, not hidden. */
const ASSUMED_DURATION_MS = 2 * 60 * 60 * 1000;

type CalendarEvent = {
  title: string;
  location: string;
  description: string;
  start: Date;
  end: Date;
  /** True when `end` is our assumption rather than the organizer's data. */
  endIsAssumed: boolean;
  url: string;
};

export function toCalendarEvent(event: EventDetail, url: string): CalendarEvent {
  const start = new Date(event.starts_at);
  const stated = event.ends_at ? new Date(event.ends_at) : null;
  const endIsAssumed = !stated || Number.isNaN(stated.valueOf());
  const end = endIsAssumed ? new Date(start.getTime() + ASSUMED_DURATION_MS) : (stated as Date);

  const location = [event.venue, event.city].filter(Boolean).join(', ');

  const notes = [
    event.description?.trim(),
    endIsAssumed ? 'End time not specified by the organizer — this entry assumes two hours.' : null,
    // A calendar entry is read on the way to the venue, so the two things
    // worth having in the body are how to get there and where to check the
    // ticket. Both are links the reader can act on from a lock screen.
    location ? `Directions: ${directionsUrl(location)}` : null,
    url,
  ].filter(Boolean);

  return {
    title: event.title,
    location,
    description: notes.join('\n\n'),
    start,
    end,
    endIsAssumed,
    url,
  };
}

/** `YYYYMMDDTHHMMSSZ` — the only format both Google and iCalendar accept. */
function stamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${stamp(event.start)}/${stamp(event.end)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Outlook Web (outlook.live.com for personal, outlook.office.com for work).
 *
 * `personal` covers Hotmail/Live/Outlook.com accounts; work and school
 * accounts live on the Office host and are silently signed out of the other
 * one. Offering the two separately is the difference between one tap and a
 * sign-in wall — this is the only place the "one .ics for everyone" rule is
 * worth breaking, because Outlook Web cannot open a local file at all.
 *
 * `startdt`/`enddt` are ISO 8601 with the Z, which Outlook parses as UTC.
 */
export function outlookCalendarUrl(event: CalendarEvent, host: 'personal' | 'work'): string {
  const base =
    host === 'personal'
      ? 'https://outlook.live.com/calendar/0/deeplink/compose'
      : 'https://outlook.office.com/calendar/0/deeplink/compose';
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: event.start.toISOString(),
    enddt: event.end.toISOString(),
    body: event.description,
    location: event.location,
  });
  return `${base}?${params.toString()}`;
}

/**
 * Yahoo Calendar.
 *
 * Yahoo takes a DURATION in `hhmm`, not an end time — passing `et` is ignored
 * and the entry silently becomes one hour. Anything over 99 hours cannot be
 * expressed in that format, so those fall back to `et`, which Yahoo does
 * honour when `dur` is absent.
 */
export function yahooCalendarUrl(event: CalendarEvent): string {
  const minutes = Math.max(1, Math.round((event.end.getTime() - event.start.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);

  const params = new URLSearchParams({
    v: '60',
    title: event.title,
    st: stamp(event.start),
    desc: event.description,
    in_loc: event.location,
  });
  if (hours < 100) {
    params.set('dur', `${String(hours).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`);
  } else {
    params.set('et', stamp(event.end));
  }
  return `https://calendar.yahoo.com/?${params.toString()}`;
}

/**
 * A directions link for the calendar body.
 *
 * Built from the venue TEXT, never from coordinates: `latitude`/`longitude`
 * are nullable and (0, 0) is a real place in the Atlantic, so a fallback
 * would put a confident wrong pin in somebody's diary. A search query lands
 * on the right place or on a search page, and both are honest.
 */
export function directionsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/**
 * RFC 5545 escaping: commas, semicolons and backslashes are field separators,
 * and a raw newline terminates the property. A venue called "The Hall, Level 2"
 * silently truncates the location without this.
 */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding — the reason `.ics` downloads silently failed.
 *
 * The spec says a content line MUST NOT exceed 75 OCTETS, and that longer
 * lines are folded by inserting CRLF followed by a single space. A realistic
 * event description produces a ~190-octet DESCRIPTION line; Google Calendar
 * tolerates it, Apple Calendar and some Outlook builds do not — they reject
 * the file or truncate the entry, with no error the user can act on.
 *
 * Folding counts OCTETS, not characters, and must never split a multi-byte
 * UTF-8 sequence — a half-written character is a corrupt file, which is worse
 * than the long line it was meant to fix.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  // 74 on continuation lines: the leading space counts toward the 75.
  while (start < bytes.length) {
    const limit = parts.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Walk back off a continuation byte (10xxxxxx) so a code point stays whole.
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    parts.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
  }
  return parts.join('\r\n ');
}

export function toIcs(event: CalendarEvent, uid: string): string {
  // CRLF line endings are required by the spec — Outlook rejects LF-only files.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Curatix//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@curatix`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`,
    `LOCATION:${escapeIcs(event.location)}`,
    `URL:${escapeIcs(event.url)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');
}

/** A filename that survives every filesystem, derived from the title. */
export function icsFilename(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'event';
  return `${slug}.ics`;
}
