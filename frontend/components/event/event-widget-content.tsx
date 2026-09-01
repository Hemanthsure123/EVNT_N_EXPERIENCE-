'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  CalendarClock,
  ChevronRight,
  FileText,
  HelpCircle,
  MapPin,
  Ticket,
} from 'lucide-react';
import type { EventContent } from '@/lib/api/event-content';
import type { EventCard as EventCardData, EventDetail } from '@/lib/api/types';
import { categoryBySlug } from '@/lib/discovery/categories';
import { formatEventDateTime, formatEventTime, formatMoney } from '@/lib/discovery/format';
import { selectSimilarEvents, isOrganiserRail } from '@/lib/discovery/similar-events';
import { availabilityLabel, sellableTiers, summariseTiers, unitPriceFor } from '@/lib/discovery/tiers';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';
import type { TicketTier } from '@/lib/api/types';
import { AddToCalendar } from './add-to-calendar';
import { Countdown } from './countdown';
import { HeroGallery, type GalleryImage } from './hero-gallery';
import { QuickFacts } from './sections';
import { ShareMenu } from './share-menu';
import type { SubSheetType } from './event-sub-sheets';

/**
 * Everything below the poster inside the mobile event widget.
 *
 * ── THE ORDER IS THE ARGUMENT ─────────────────────────────────────────────
 *
 * Category, title, when, where, how long until it starts, what it costs, what
 * it is, what to know, what it looks like, who is running it, the small print,
 * what else to look at. That is "what is it / when / where / what does it cost
 * / what should I know / who organises it / what else" — the order somebody
 * actually decides in, and it is fixed rather than an arrangement.
 *
 * ── A SECTION WITH NOTHING BEHIND IT IS ABSENT, NOT EMPTY ─────────────────
 *
 * Every block here is conditional on real data. No gallery when the organiser
 * uploaded no photographs; no running-order row when they published none; no
 * second category pill invented to balance the first; no similar-events rail
 * padded with unrelated events. An empty panel behind a chevron is worse than
 * no chevron, and on access or age information an empty panel reads as a claim
 * that there is no restriction — which is not what a blank column means.
 *
 * ── AND IT REUSES THE PAGE'S COMPONENTS ───────────────────────────────────
 *
 * `Countdown`, `QuickFacts`, `HeroGallery`, `ShareMenu` and `AddToCalendar` are
 * the same ones the desktop event page renders. They are token-styled, and this
 * surface is always dark, which the deck handles by scoping `dark` around the
 * whole widget. So there is one lightbox, one calendar builder and one clock —
 * not a mobile fork of each.
 */

export type EventWidgetContentProps = {
  event: EventCardData;
  detail: EventDetail | null;
  content: EventContent | null;
  tiers: TicketTier[] | null;
  /** The feed the widget was opened from — the pool for "similar events". */
  pool: readonly EventCardData[];
  onOpenSheet: (sheet: NonNullable<SubSheetType>) => void;
  /** Switches the deck to another event without leaving the widget. */
  onSelectEvent?: (eventId: string) => void;
};

export function EventWidgetContent({
  event,
  detail,
  content,
  tiers,
  pool,
  onOpenSheet,
  onSelectEvent,
}: EventWidgetContentProps) {
  // The REAL category only. A second pill ("Nightlife") used to be hard-coded
  // beside it, so every event on the platform claimed the same two tags.
  const category = categoryBySlug(event.category);
  const summary = React.useMemo(() => summariseTiers(tiers), [tiers]);
  const visibleTiers = React.useMemo(
    () => (tiers ? sellableTiers(tiers).slice(0, 3) : []),
    [tiers],
  );

  const galleryImages: GalleryImage[] = React.useMemo(
    () =>
      (content?.media ?? [])
        .filter((item) => item.kind === 'gallery')
        .map((item) => ({ url: item.url, alt: item.alt_text || event.title })),
    [content, event.title],
  );

  const similar = React.useMemo(
    () => selectSimilarEvents(event, pool, { limit: 8 }),
    [event, pool],
  );
  const railIsOrganiser = isOrganiserRail(event, similar);

  const firstTimelineEntry = (content?.timeline ?? []).find((entry) => entry.starts_at);
  const aboutPreview = detail?.short_description?.trim() || detail?.description?.trim() || '';
  const hasMoreAbout = Boolean(detail?.description?.trim());

  return (
    <div className="flex flex-col gap-6 px-4 pt-4">
      {/* 1. Category ---------------------------------------------------- */}
      {category ? (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-caption font-semibold text-muted-foreground">
            {category.label}
          </span>
        </div>
      ) : null}

      {/* 2. Title and 3. when -------------------------------------------- */}
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-extrabold leading-snug tracking-tight text-foreground">
          {event.title}
        </h2>
        <p className="text-body-sm font-semibold text-primary">
          {formatEventDateTime(event.starts_at)}
        </p>
      </div>

      {/* 4. Where -------------------------------------------------------- */}
      <DisclosureRow
        icon={<MapPin className="size-5" aria-hidden />}
        label={`${event.venue}, ${event.city}`}
        hint="Venue details"
        onClick={() => onOpenSheet('venue')}
      />

      {/* 5. Schedule. The summary states a REAL time or omits it — this row
             used to read "Starts at 8 PM" on every event on the platform. */}
      <DisclosureRow
        icon={<CalendarClock className="size-5" aria-hidden />}
        label={
          firstTimelineEntry?.starts_at
            ? `${firstTimelineEntry.label} at ${formatEventTime(firstTimelineEntry.starts_at)}`
            : `Starts at ${formatEventTime(event.starts_at)}`
        }
        hint="View full schedule & timeline"
        onClick={() => onOpenSheet('schedule')}
      />

      {/* 6. Actions. All three are the existing implementations — none of them
             navigates away from the widget. */}
      <div className="flex items-center gap-2">
        <ShareMenu
          title={event.title}
          path={eventPath(event)}
          className="flex-1 justify-center"
        />
        {detail ? <AddToCalendar event={detail} className="flex-1 justify-center" /> : null}
      </div>

      {/* 7. Starts in ---------------------------------------------------- */}
      <Countdown startsAt={event.starts_at} />

      {/* 8. Tickets ------------------------------------------------------ */}
      {visibleTiers.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-body font-extrabold text-foreground">Tickets</h3>
            {availabilityLabel(summary.state) ? (
              <span className="text-caption font-semibold text-muted-foreground">
                {availabilityLabel(summary.state)}
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {visibleTiers.map((tier) => (
              <li key={tier.id} className="flex items-center justify-between gap-3 p-3.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body-sm font-semibold text-foreground">
                    {tier.name}
                  </span>
                  {tier.available <= 0 ? (
                    <span className="text-caption text-muted-foreground">Sold out</span>
                  ) : null}
                </div>
                <span className="shrink-0 text-body-sm font-bold tabular-nums text-foreground">
                  {formatMoney(unitPriceFor(tier))}
                </span>
              </li>
            ))}
          </ul>
          {tiers && sellableTiers(tiers).length > visibleTiers.length ? (
            <p className="text-caption text-muted-foreground">
              {sellableTiers(tiers).length - visibleTiers.length} more ticket type
              {sellableTiers(tiers).length - visibleTiers.length === 1 ? '' : 's'} on the next screen
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 9. About -------------------------------------------------------- */}
      {aboutPreview ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-body font-extrabold text-foreground">About the event</h3>
          <p className="line-clamp-3 whitespace-pre-line text-body-sm text-muted-foreground">
            {aboutPreview}
          </p>
          {hasMoreAbout ? (
            <button
              type="button"
              onClick={() => onOpenSheet('about')}
              className="flex items-center gap-1 self-start text-body-sm font-bold text-foreground"
            >
              Read more <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </button>
          ) : null}
        </section>
      ) : null}

      {/* 10. Things to know. Four facts, then "See all" — one component
              renders both lengths, so the preview cannot drift from the list. */}
      {detail ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-extrabold text-foreground">Things to know</h3>
          <QuickFacts event={detail} limit={4} />
          <button
            type="button"
            onClick={() => onOpenSheet('things_to_know')}
            className="flex items-center gap-1 self-start text-body-sm font-bold text-foreground"
          >
            See all <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </button>
        </section>
      ) : null}

      {/* 11. Gallery. Thumbnails only — `hideMainImage` keeps the big
              duplicate copy of the poster off a screen that already has one,
              and taps open the page's own lightbox rather than a second. */}
      {galleryImages.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-extrabold text-foreground">Gallery</h3>
          <HeroGallery images={galleryImages} priority={false} hideMainImage />
        </section>
      ) : null}

      {/* 12. Organiser --------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h3 className="text-body font-extrabold text-foreground">Organised by</h3>
        {/* An explicit name. Without one the button announces as its own
            contents — an initial and a company name — which says who runs the
            event but not that pressing it opens anything. */}
        <button
          type="button"
          onClick={() => onOpenSheet('organiser')}
          aria-label={`About ${event.organization_name}`}
          className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-3.5 text-left transition-colors active:bg-muted"
        >
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-body font-bold text-foreground"
            aria-hidden
          >
            {(event.organization_name || '?').trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
            {event.organization_name}
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </section>

      {/* 13. More — the two long-form documents, grouped rather than
              scattered through the page. */}
      <section className="flex flex-col gap-3">
        <h3 className="text-body font-extrabold text-foreground">More</h3>
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          <MoreRow
            icon={<HelpCircle className="size-5" aria-hidden />}
            label="Frequently asked questions"
            onClick={() => onOpenSheet('faq')}
          />
          <MoreRow
            icon={<FileText className="size-5" aria-hidden />}
            label="Terms and conditions"
            onClick={() => onOpenSheet('terms')}
          />
        </div>
      </section>

      {/* 14. Similar events ---------------------------------------------- */}
      {similar.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-extrabold text-foreground">
            {railIsOrganiser ? `More from ${event.organization_name}` : 'Similar events'}
          </h3>
          {/* A rail with real edge peeking and CSS scroll-snap — no library, no
              scroll handler, and it stays draggable and swipeable. */}
          <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-pl-4 px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {similar.map((other) => (
              <li key={other.id} className="w-36 shrink-0 snap-start">
                <SimilarCard event={other} onSelect={onSelectEvent} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A row carries a SUMMARY, not just a label. "Venue details" alone makes the
 * reader press to find out whether pressing was worth it; the venue name has
 * already answered the common case.
 */
function DisclosureRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-3.5 text-left transition-colors active:bg-muted"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-sm font-semibold text-foreground">{label}</span>
        <span className="truncate text-caption text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function MoreRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-control items-center gap-3.5 p-3.5 text-left transition-colors active:bg-muted"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground">
        {label}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/**
 * A card in the similar-events rail.
 *
 * When the deck can switch to it in place (`onSelectEvent`) it is a BUTTON and
 * stays inside the widget, which is the whole architecture — the widget is the
 * mobile event page, so moving between events must not leave it. It falls back
 * to a real link when it cannot, so the row is never a dead end.
 */
function SimilarCard({
  event,
  onSelect,
}: {
  event: EventCardData;
  onSelect?: (eventId: string) => void;
}) {
  const body = (
    <>
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-muted">
        {event.poster_url ? (
          <Image src={event.poster_url} alt="" fill sizes="144px" className="object-cover" />
        ) : (
          <Ticket className="absolute inset-0 m-auto size-8 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="mt-2 block truncate text-caption font-semibold text-foreground">
        {event.title}
      </span>
      <span className="block truncate text-caption text-muted-foreground">
        {formatEventDateTime(event.starts_at)}
      </span>
    </>
  );

  const className = cn('block w-full text-left transition-transform active:scale-95');

  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(event.id)} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={eventPath(event)} className={className}>
      {body}
    </Link>
  );
}
