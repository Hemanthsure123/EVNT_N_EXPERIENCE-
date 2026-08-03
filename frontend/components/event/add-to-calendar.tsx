'use client';

import * as React from 'react';
import { CalendarPlus, Check, Download } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { EventDetail } from '@/lib/api/types';
import {
  googleCalendarUrl,
  icsFilename,
  outlookCalendarUrl,
  toCalendarEvent,
  toIcs,
  yahooCalendarUrl,
} from '@/lib/event/calendar';
import { cn } from '@/lib/utils/cn';

/**
 * Add to calendar.
 *
 * ── WEB TARGETS GET A LINK; EVERYTHING ELSE GETS THE FILE ─────────────────
 *
 * Google, Outlook Web and Yahoo cannot open a local `.ics` — a download on a
 * phone with a webmail calendar is a file the OS does not know what to do
 * with. Each gets its own compose URL instead, and Outlook is split into
 * personal and work because a work account is signed out of the personal host
 * entirely.
 *
 * Apple Calendar, desktop Outlook and everything else share ONE `.ics`
 * download. Listing those as separate buttons would be three entries
 * producing an identical file.
 *
 * ── THE ASSUMED END TIME IS DISCLOSED, NOT HIDDEN ─────────────────────────
 *
 * `ends_at` is nullable. When the organizer left it blank the entry assumes
 * two hours — and says so, both in the menu before the click and inside the
 * calendar body afterwards. Writing an unstated duration into someone's diary
 * silently is how they plan an evening around a number nobody gave them.
 *
 * ── THE FILE IS BUILT IN THE BROWSER ──────────────────────────────────────
 *
 * No endpoint, no round trip. Everything it needs is already on the page, so
 * the download is instant and works offline once the page has loaded.
 */
export function AddToCalendar({ event, className }: { event: EventDetail; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);

  // Built lazily and only on the client: `window.location` does not exist
  // during the server render, and the canonical URL is what belongs in the
  // calendar entry rather than whatever path the visitor arrived on.
  const calendar = React.useMemo(
    () =>
      toCalendarEvent(
        event,
        typeof window === 'undefined' ? '' : `${window.location.origin}/events/${event.id}`,
      ),
    [event],
  );

  React.useEffect(() => {
    if (!downloaded) return;
    const timer = window.setTimeout(() => setDownloaded(false), 2500);
    return () => window.clearTimeout(timer);
  }, [downloaded]);

  const download = () => {
    const blob = new Blob([toIcs(calendar, event.id)], {
      type: 'text/calendar;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = icsFilename(event.title);
    anchor.click();
    // Revoking immediately would race the download in Safari; a tick is enough
    // for the browser to have taken the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          // The pill vocabulary, matching Share and Save beside it: fully
          // rounded, hairline, 44px. It was the one rounded-md control in the
          // row, which read as a different kind of button than its neighbours.
          'inline-flex h-control items-center gap-2 rounded-full border border-input bg-surface px-pill text-label text-foreground',
          'transition-colors duration-fast ease-out hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
      >
        {downloaded ? (
          <Check className="size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <CalendarPlus className="size-4 shrink-0" aria-hidden />
        )}
        {downloaded ? 'Added' : 'Add to calendar'}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-1.5">
        {(
          [
            ['Google Calendar', googleCalendarUrl(calendar)],
            ['Outlook.com', outlookCalendarUrl(calendar, 'personal')],
            ['Outlook (work or school)', outlookCalendarUrl(calendar, 'work')],
            ['Yahoo Calendar', yahooCalendarUrl(calendar)],
          ] as const
        ).map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <CalendarPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {label}
          </a>
        ))}
        <div className="my-1 border-t border-border" role="separator" />
        <button
          type="button"
          onClick={download}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0">
            <span className="block">Apple Calendar or download</span>
            <span className="block text-caption text-muted-foreground">Downloads an .ics file</span>
          </span>
        </button>

        {calendar.endIsAssumed ? (
          <p className="border-t border-border px-2.5 pb-1 pt-2 text-caption text-muted-foreground">
            The organizer did not give an end time, so this entry assumes two hours.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
