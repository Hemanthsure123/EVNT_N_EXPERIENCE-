import * as React from 'react';
import { Container } from '@/components/shell/container';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { BookingBar } from '@/components/event/booking-bar';
import { Countdown } from '@/components/event/countdown';
import { HeroGallery, type GalleryImage } from '@/components/event/hero-gallery';
import { AddToCalendar } from '@/components/event/add-to-calendar';
import { ShareMenu } from '@/components/event/share-menu';
import {
  AccessibilityNotes,
  EventFaqs,
  Faqs,
  OrganizerCard,
  Policies,
  QuickFacts,
  RunningOrder,
  SectionHeading,
  VenueCard,
} from '@/components/event/sections';
import { TicketPanel } from '@/components/event/ticket-panel';
import type { EventContent } from '@/lib/api/event-content';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong, formatEventTime } from '@/lib/discovery/format';
import { availabilityLabel, isUrgent, summariseTiers } from '@/lib/discovery/tiers';
import { cn } from '@/lib/utils/cn';

/**
 * The event page, as a component — so the Studio's preview IS the event page.
 *
 * ── WHY THIS WAS EXTRACTED ────────────────────────────────────────────────
 *
 * The organizer's preview used to be a hand-drawn approximation: a small card,
 * four stat tiles and a mock search snippet. It answered "roughly what will
 * this look like" and nothing more, and every change to the real page made it
 * a little less true — its search snippet had already drifted from what
 * `generateMetadata` actually emits.
 *
 * A preview whose only job is to show somebody the page they are about to
 * publish should BE that page. So the whole body lives here, and both callers
 * render the same component with the same props:
 *
 *   app/(site)/events/[id]/page.tsx   the live page, from the API
 *   components/organizer/wizard/…     the preview, from the local draft
 *
 * There is no second layout to keep in sync, and no way for the preview to
 * describe a page that will not appear. This is the same rule as the one
 * auth panel: two copies of a surface is how the two drift.
 *
 * ── WHAT `preview` CHANGES, AND WHAT IT DELIBERATELY DOES NOT ─────────────
 *
 * ONLY the things that cannot work for a draft:
 *
 *   - the ticket panel stops polling live availability and its buy button goes
 *     inert (there is nothing to buy yet, and a draft's tiers may not exist on
 *     the server to be polled),
 *   - save/share/calendar are dropped: each needs a public URL or an event id,
 *     and offering "share" for an unpublished draft is offering a dead link,
 *   - the mobile booking bar is dropped for the same reason as the buy button.
 *
 * Everything else is identical — the gallery, the urgency and sold-out
 * badges, the countdown, the quick facts, the running order, the organiser and
 * venue cards, the FAQs, the policies. If it is wrong in the preview, it is
 * wrong on the page.
 *
 * `related` is a SLOT rather than a prop this component fetches: on the live
 * page it is an async server component streamed behind its own Suspense
 * boundary, and the preview has no business making that request at all.
 */
export function EventPageBody({
  event,
  tiers,
  content,
  preview = false,
  related = null,
}: {
  event: EventDetail;
  tiers: TicketTier[];
  content: EventContent;
  preview?: boolean;
  related?: React.ReactNode;
}) {
  const category = inferCategory(event);
  const summary = summariseTiers(tiers);
  const availability = availabilityLabel(summary.state);

  /**
   * What the gallery shows, in the order it shows it.
   *
   * The organiser's HERO image leads if they set one; otherwise `poster_url`,
   * which is the column every card and link preview already uses — so the page
   * opens on the same picture the visitor clicked. Gallery images follow in
   * their stored `position`. Thumbnail and mobile crops are deliberately
   * excluded: they are alternate renditions of an image already here, not more
   * photographs, and padding a filmstrip with duplicates is exactly the
   * "repeat the same picture" failure this component was written to avoid.
   */
  const hero = content.media.find((item) => item.kind === 'hero');
  const gallery: GalleryImage[] = [
    ...(hero
      ? [{ url: hero.url, alt: hero.alt_text || event.title }]
      : event.poster_url
        ? [{ url: event.poster_url, alt: event.title }]
        : []),
    ...content.media
      .filter((item) => item.kind === 'gallery')
      .map((item) => ({ url: item.url, alt: item.alt_text || event.title })),
  ];

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: event.city, href: `/cities/${event.city.toLowerCase()}` },
    ...(category ? [{ label: category.label, href: `/categories/${category.slug}` }] : []),
    { label: event.title },
  ];

  return (
    <>
      <Container className="flex flex-col gap-8 py-6 lg:gap-10 lg:py-8">
        <Breadcrumb items={crumbs} />

        {/*
          ONE ticket panel, placed by the grid rather than duplicated.
          An earlier version rendered it twice — once inline for mobile, once in
          a `hidden lg:block` rail — which put two `id="tickets"` anchors and two
          "Tickets" regions in every document, and gave screen readers the whole
          panel twice at every width. Explicit row/column placement moves the one
          instance instead: source order (hero, panel, everything else) is the
          mobile reading order, and at `lg` the panel jumps to column two, row
          one, where it sticks.
        */}
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
            <HeroGallery images={gallery} categorySlug={category?.slug} />

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {category ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-caption text-muted-foreground">
                    <category.icon className="size-3.5" aria-hidden />
                    {category.label}
                  </span>
                ) : null}
                {availability ? (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-1 text-caption',
                      summary.state.kind === 'sold_out'
                        ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                        : isUrgent(summary.state)
                          ? 'bg-warning-subtle text-warning-subtle-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {availability}
                  </span>
                ) : null}
              </div>

              <h1 className="text-h2 md:text-h1">{event.title}</h1>

              {/* WHEN, then WHERE — two lines, not one run-on. The date is the
                  single fact that decides whether the rest of the page is worth
                  reading, and it is one of the two places the target language
                  still sanctions the violet accent. */}
              <div className="flex flex-col gap-1">
                <p className="text-body-lg font-semibold text-primary">
                  {formatEventDateLong(event.starts_at)} · {formatEventTime(event.starts_at)}
                </p>
                <p className="text-body text-muted-foreground">
                  {event.venue}, {event.city}
                </p>
              </div>

              {/* Save, share and add-to-calendar all need a PUBLISHED event —
                  a public URL to share, an id to save against. In a preview
                  they would each be a control that cannot do its one job. */}
              {preview ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  <ShareMenu title={event.title} path={`/events/${event.id}`} />
                  {/* Beside share and save: all three are "keep this for later"
                      actions, and separating them would make the calendar the
                      only one a visitor has to hunt for. */}
                  <AddToCalendar event={event} />
                  {/* Off the poster and into the action row, so it drops
                      `.glass-media`'s photo scrim for the same hairline pill the
                      two beside it wear. `size-11` is the 44px touch floor. */}
                  <FavouriteButton
                    eventId={event.id}
                    title={event.title}
                    className="size-11 border-input bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
                  />
                </div>
              )}
            </div>

            <Countdown startsAt={event.starts_at} />
          </div>

          {/* `lg:top-sticky-top-lg` is the header's own height plus a rung of
              breathing room, derived rather than the hard-coded 80px it was —
              which had already drifted from a 72px header. */}
          <div className="lg:sticky lg:top-sticky-top-lg lg:col-start-2 lg:row-start-1">
            <TicketPanel eventId={event.id} initialTiers={tiers} preview={preview} />
          </div>

          <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
            <section className="flex flex-col gap-4">
              <SectionHeading>Good to know</SectionHeading>
              <QuickFacts event={event} />
            </section>

            {event.description ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>About this event</SectionHeading>
                <p className="max-w-2xl whitespace-pre-line text-body-lg text-muted-foreground">
                  {event.description}
                </p>
              </section>
            ) : null}

            {/* Each of these renders ONLY when the organiser supplied it. There
                is no "running order coming soon" and no empty accessibility
                panel — a heading over nothing is a promise the page cannot
                keep, and on access information specifically, silence is honest
                where a placeholder would be a claim. */}
            {content.timeline.length ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>What happens when</SectionHeading>
                <RunningOrder entries={content.timeline} />
              </section>
            ) : null}

            <section className="flex flex-col gap-4">
              <SectionHeading>Organiser</SectionHeading>
              <OrganizerCard event={event} />
            </section>

            <section className="flex flex-col gap-4">
              <SectionHeading>Getting there</SectionHeading>
              <VenueCard event={event} />
            </section>

            {event.accessibility_notes?.trim() ? (
              <section className="flex flex-col gap-4">
                <SectionHeading>Accessibility</SectionHeading>
                <AccessibilityNotes notes={event.accessibility_notes} />
              </section>
            ) : null}

            <section className="flex flex-col gap-4">
              <SectionHeading>Frequently asked</SectionHeading>
              {/* The organiser's own questions first: "is there parking at THIS
                  venue" beats "how does a QR ticket work" for someone deciding
                  tonight. The platform set below is about how the platform
                  works and is identical on every event. */}
              <EventFaqs faqs={content.faqs} />
              <Faqs />
            </section>

            <section className="flex flex-col gap-4">
              <SectionHeading>Before you book</SectionHeading>
              <Policies />
            </section>
          </div>
        </div>

        {related}
      </Container>

      {/* Mobile only, and only once the panel above has scrolled away. */}
      {preview ? null : <BookingBar eventId={event.id} initialTiers={tiers} />}
    </>
  );
}
