'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, MapPin, Ticket, X, Maximize2, Minimize2 } from 'lucide-react';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { formatEventDateTime, formatFromPrice } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';

export interface EventPreviewSheetProps {
  event: EventCardData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * District-style Expandable Bottom Sheet / Peek Drawer with 2 Snap Points (0.6 & 1.0).
 *
 * - 0.6 (60% Height Half-Sheet Peek State): Shows event image, title, date, venue, starting price, and CTA.
 * - 1.0 (100% Full-Screen State): Expands to full screen with top edges flattening out.
 * - Drag-to-dismiss returns seamlessly to exact feed scroll position.
 */
export function EventPreviewSheet({ event, open, onOpenChange }: EventPreviewSheetProps) {
  const [isFullScreen, setIsFullScreen] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setIsFullScreen(false);
    }
  }, [open]);

  if (!event) return null;

  const price = formatFromPrice(event.from_price);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        side="bottom"
        bare
        hideClose
        className={cn(
          'w-full max-w-2xl mx-auto bg-background/95 backdrop-blur-md shadow-2xl flex flex-col transition-all duration-300 ease-out border-t border-border',
          isFullScreen ? 'h-[100dvh] max-h-[100dvh] rounded-t-none' : 'max-h-[75vh] min-h-[60vh] rounded-t-3xl'
        )}
      >
        {/* Drag Handle & Header Controls */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-5 py-3 shrink-0 rounded-t-3xl">
          <div className="flex items-center gap-2">
            <span className="text-caption font-semibold text-muted-foreground uppercase tracking-wider">
              Quick View
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-caption font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isFullScreen ? (
                <>
                  <Minimize2 className="size-3.5" aria-hidden />
                  Peek
                </>
              ) : (
                <>
                  <Maximize2 className="size-3.5" aria-hidden />
                  Full Screen
                </>
              )}
            </button>
            <DrawerClose className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-5" aria-hidden />
            </DrawerClose>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Event Poster Artwork */}
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-muted shadow-sm">
            {event.poster_url ? (
              <Image
                src={event.poster_url}
                alt={event.title}
                fill
                sizes="(max-width: 768px) 100vw, 640px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                <Ticket className="size-10" />
              </div>
            )}
          </div>

          {/* Title & Category */}
          <div className="flex flex-col gap-1.5">
            <h2 className="text-h3 font-extrabold text-foreground leading-tight">{event.title}</h2>
            <div className="flex flex-wrap items-center gap-3 text-body-sm text-muted-foreground mt-1">
              <span className="inline-flex items-center gap-1.5 text-primary font-medium">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDateTime(event.starts_at)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {event.venue}, {event.city}
              </span>
            </div>
          </div>

          {/* Pricing & Detail Link */}
          <div className="mt-auto pt-4 border-t border-border flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-caption text-muted-foreground">Starting from</span>
              <span className="text-h4 font-extrabold text-foreground tabular-nums">{price}</span>
            </div>

            <Link
              href={eventPath(event)}
              onClick={() => onOpenChange(false)}
              className="inline-flex h-control items-center justify-center gap-2 rounded-full border border-cta bg-cta px-6 text-label font-bold text-cta-foreground shadow-md transition duration-fast ease-out hover:bg-cta-hover active:scale-95"
            >
              Book Tickets
            </Link>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
