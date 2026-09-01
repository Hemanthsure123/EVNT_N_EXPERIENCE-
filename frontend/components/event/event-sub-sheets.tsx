'use client';

import * as React from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EventContent } from '@/lib/api/event-content';
import type { EventCard as EventCardData, EventDetail } from '@/lib/api/types';
import { formatEventDateTime, formatFromPrice } from '@/lib/discovery/format';
import { selectSimilarEvents } from '@/lib/discovery/similar-events';
import { useEventDeck } from '@/lib/discovery/event-deck-context';
import {
  AccessibilityNotes,
  EventFaqs,
  Faqs,
  OrganizerPolicies,
  Policies,
  QuickFacts,
  RunningOrder,
  VenueCard,
} from './sections';

/**
 * The nested sheets the mobile event widget opens.
 *
 * ── EVERY WORD IN HERE USED TO BE A LITERAL ───────────────────────────────
 *
 * This file previously rendered, identically for every event on the platform:
 * a description about "Quake Arena", the tagline "Feel the beat. Own the
 * floor.", a schedule of "8:00 PM / 11:59 PM", five invented policies ("Kids
 * not allowed", "Event will be in English"), a venue address in "Kondapur",
 * a "3.9 ★" rating, "7.1 km away", and an "ongoing events" list containing the
 * SAME event you were already looking at.
 *
 * None of it came from the API, because the widget never called the API. It now
 * receives the real `EventDetail` and `EventContent`, and every sheet renders
 * what the organiser actually wrote — or renders nothing.
 *
 * ── AND IT REUSES THE PAGE'S OWN SECTIONS ─────────────────────────────────
 *
 * The venue card, running order, fact grid, FAQ accordion and policy lists are
 * imported from `sections.tsx` — the very components the desktop event page
 * renders. There is no second copy to drift, which matters most for the two
 * that are legal text. A hand-written mobile duplicate of the refund policy is
 * how a platform ends up telling two customers two different things.
 *
 * They are token-styled (`text-foreground`, `bg-surface`…), and this surface is
 * always dark regardless of the site theme — so the sheet root carries the
 * `dark` class, which re-points those tokens at the dark palette for its whole
 * subtree. That is why reuse is possible at all instead of a dark fork.
 *
 * ── HEADINGS START AT h3 ──────────────────────────────────────────────────
 *
 * The sheet's own title is the h2. A subsection using h2 as well would sit as a
 * peer of the thing it belongs to, and the outline a screen-reader user
 * navigates by would report two unrelated headings.
 */

export type SubSheetType =
  | 'venue'
  | 'schedule'
  | 'about'
  | 'things_to_know'
  | 'organiser'
  | 'faq'
  | 'terms'
  | null;

const SHEET_TITLES: Record<NonNullable<SubSheetType>, string> = {
  // NOT "Restaurant details". That was the reference design's word — that
  // product sells restaurant bookings as well as tickets. This one does not.
  venue: 'Venue details',
  schedule: 'Schedule and timeline',
  about: 'About this event',
  things_to_know: 'Things to know',
  organiser: 'About the organiser',
  faq: 'Frequently asked questions',
  terms: 'Terms and conditions',
};

export interface EventSubSheetsProps {
  sheetType: SubSheetType;
  onClose: () => void;
  event: EventCardData;
  /** Null until the detail read lands; every sheet degrades to what the card
   *  already knows rather than showing a spinner over an empty panel. */
  detail: EventDetail | null;
  content: EventContent | null;
  /** The feed the widget was opened from, for the organiser's other events. */
  pool?: readonly EventCardData[];
}

export function EventSubSheets({
  sheetType,
  onClose,
  event,
  detail,
  content,
  pool = [],
}: EventSubSheetsProps) {
  return (
    <AnimatePresence>
      {sheetType ? (
        // `key` on the sheet, so React does not reuse one instance across two
        // different disclosures and carry the previous sheet's scroll position
        // into the next.
        <div key={sheetType} className="fixed inset-0 z-modal flex flex-col justify-end sm:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={SHEET_TITLES[sheetType]}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
            // No `dark` here any more. It matched the deck card it opens over, and
            // that card follows the theme now — a sub-sheet that stayed dark
            // would be a black panel sliding over a white one.
            className="relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border bg-surface text-foreground shadow-2xl"
          >
            {/* Pinned header, scrolling body — a long policy set must never be
                able to push its own close control off the screen. */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 pb-3 pt-4">
              <h2 className="text-h4 font-bold tracking-tight text-foreground">
                {SHEET_TITLES[sheetType]}
              </h2>
              {/* EXACTLY ONE close control on this surface. */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-90"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div
              className="flex-1 overflow-y-auto overscroll-contain px-5 pt-5"
              style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            >
              <SheetBody
                sheetType={sheetType}
                event={event}
                detail={detail}
                content={content}
                pool={pool}
              />
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function SheetBody({
  sheetType,
  event,
  detail,
  content,
  pool,
}: {
  sheetType: NonNullable<SubSheetType>;
  event: EventCardData;
  detail: EventDetail | null;
  content: EventContent | null;
  pool: readonly EventCardData[];
}) {
  switch (sheetType) {
    case 'venue':
      return <VenueSheet event={event} detail={detail} />;
    case 'schedule':
      return <ScheduleSheet event={event} detail={detail} content={content} />;
    case 'about':
      return <AboutSheet event={event} detail={detail} />;
    case 'things_to_know':
      return <ThingsToKnowSheet detail={detail} />;
    case 'organiser':
      return <OrganiserSheet event={event} pool={pool} />;
    case 'faq':
      return <FaqSheet content={content} />;
    case 'terms':
      return <TermsSheet detail={detail} />;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Venue                                                                      */
/* -------------------------------------------------------------------------- */

function VenueSheet({ event, detail }: { event: EventCardData; detail: EventDetail | null }) {
  return (
    <div className="flex flex-col gap-5 pb-2">
      {detail ? (
        // The page's own venue card: it renders a real map when the organiser
        // pinned a place, and a stylised grid with a Directions link when they
        // did not — never a coordinate it invented.
        <VenueCard event={detail} />
      ) : (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-card">
          <p className="text-body-lg font-semibold text-foreground">{event.venue}</p>
          <p className="text-body-sm text-muted-foreground">{event.city}</p>
        </div>
      )}

      {detail?.accessibility_notes ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-body font-semibold text-foreground">Accessibility</h3>
          <AccessibilityNotes notes={detail.accessibility_notes} />
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Schedule                                                                   */
/* -------------------------------------------------------------------------- */

function ScheduleSheet({
  event,
  detail,
  content,
}: {
  event: EventCardData;
  detail: EventDetail | null;
  content: EventContent | null;
}) {
  const timeline = content?.timeline ?? [];

  return (
    <div className="flex flex-col gap-5 pb-2">
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-sunken p-card">
        <p className="text-caption uppercase tracking-wide text-muted-foreground">Doors</p>
        <p className="text-body font-semibold text-foreground">
          {formatEventDateTime(event.starts_at)}
        </p>
        {detail?.ends_at ? (
          <p className="text-body-sm text-muted-foreground">
            Ends {formatEventDateTime(detail.ends_at)}
          </p>
        ) : null}
      </div>

      {timeline.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-semibold text-foreground">Running order</h3>
          <RunningOrder entries={timeline} />
        </section>
      ) : (
        // NOT a fabricated two-step timeline. This used to render "Event starts
        // 8:00 PM / Event ends 11:59 PM" for every event on the platform,
        // including ones that start at noon.
        <p className="text-body-sm text-muted-foreground">
          The organiser has not published a running order for this event.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* About                                                                      */
/* -------------------------------------------------------------------------- */

function AboutSheet({ event, detail }: { event: EventCardData; detail: EventDetail | null }) {
  const summary = detail?.short_description?.trim();
  const description = detail?.description?.trim();

  if (!summary && !description) {
    return (
      <p className="pb-2 text-body-sm text-muted-foreground">
        The organiser has not written a description for {event.title} yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-2 leading-relaxed">
      {summary ? <p className="text-body font-semibold text-foreground">{summary}</p> : null}
      {description ? (
        // `whitespace-pre-line`, so the organiser's own paragraphing survives.
        <p className="whitespace-pre-line text-body-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Things to know                                                             */
/* -------------------------------------------------------------------------- */

function ThingsToKnowSheet({ detail }: { detail: EventDetail | null }) {
  if (!detail) {
    return <p className="pb-2 text-body-sm text-muted-foreground">Loading event details…</p>;
  }

  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* The same component the page renders, unlimited here and limited to
          four on the widget itself. One source, two lengths — a hand-written
          preview drifts from the full list the first time a fact is added. */}
      <QuickFacts event={detail} />

      {detail.accessibility_notes ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-body font-semibold text-foreground">Accessibility</h3>
          <AccessibilityNotes notes={detail.accessibility_notes} />
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Organiser                                                                  */
/* -------------------------------------------------------------------------- */

function OrganiserSheet({
  event,
  pool,
}: {
  event: EventCardData;
  pool: readonly EventCardData[];
}) {
  const initial = (event.organization_name || '?').trim().charAt(0).toUpperCase();
  // Their OTHER events — the previous version listed the event you were already
  // looking at, under the heading "Ongoing events".
  const { openEvent } = useEventDeck();
  const others = React.useMemo(
    () => selectSimilarEvents(event, pool, { limit: 6 }).filter(
      (candidate) => candidate.organization_id === event.organization_id,
    ),
    [event, pool],
  );

  return (
    <div className="flex flex-col gap-6 pb-2">
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-sunken p-4">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-h4 font-bold text-foreground"
          aria-hidden
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body font-semibold text-foreground">{event.organization_name}</p>
          {/* NO like percentage, rating count, hosted-event tally or "hosting
              for N years". There is no review model and no hosted-event column
              on this payload — those numbers were literals, identical for every
              organiser, in the exact spot somebody reads to decide whether to
              hand over money. */}
          <p className="text-caption text-muted-foreground">Event organiser</p>
        </div>
      </div>

      {others.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-semibold text-foreground">
            More from {event.organization_name}
          </h3>
          <ul className="flex flex-col gap-3">
            {others.map((other) => (
              <li key={other.id}>
                {/* Inside the widget already, so this must not navigate OUT
                    of it — a tap here used to close the app-shaped experience
                    and land on the standalone page, from the one surface that
                    is by definition already on a phone. */}
                <button
                  type="button"
                  onClick={() => openEvent(other)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors active:bg-muted"
                >
                  <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {other.poster_url ? (
                      <Image src={other.poster_url} alt="" fill sizes="56px" className="object-cover" />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-body-sm font-semibold text-foreground">
                      {other.title}
                    </span>
                    <span className="truncate text-caption text-muted-foreground">
                      {formatEventDateTime(other.starts_at)}
                    </span>
                    <span className="truncate text-caption text-muted-foreground">
                      {other.venue}, {other.city}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption font-semibold tabular-nums text-foreground">
                    {formatFromPrice(other.from_price)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ and terms                                                              */
/* -------------------------------------------------------------------------- */

function FaqSheet({ content }: { content: EventContent | null }) {
  const faqs = content?.faqs ?? [];

  return (
    <div className="flex flex-col gap-6 pb-2">
      {faqs.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-semibold text-foreground">About this event</h3>
          {/* Native <details>/<summary> accordion, expanding inline. Reused, so
              the plus-to-minus animation and the keyboard behaviour are the
              page's rather than a second implementation of both. */}
          <EventFaqs faqs={faqs} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-foreground">Booking and entry</h3>
        <Faqs />
      </section>
    </div>
  );
}

function TermsSheet({ detail }: { detail: EventDetail | null }) {
  const organiserPolicies = detail?.policies ?? [];

  return (
    <div className="flex flex-col gap-6 pb-2">
      {organiserPolicies.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-body font-semibold text-foreground">The organiser&rsquo;s terms</h3>
          <OrganizerPolicies policies={organiserPolicies} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-body font-semibold text-foreground">Platform policies</h3>
        {/* True of every event and not an organiser's to edit, which is exactly
            why these are hard-coded and the ones above are not. */}
        <Policies />
      </section>
    </div>
  );
}
