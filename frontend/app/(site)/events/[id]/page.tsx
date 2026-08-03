import * as React from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { EventGrid, EventGridSkeleton } from '@/components/discovery/event-grid';
import { FavouriteButton } from '@/components/discovery/favourite-button';
import { BookingBar } from '@/components/event/booking-bar';
import { Countdown } from '@/components/event/countdown';
import { HeroGallery } from '@/components/event/hero-gallery';
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
import type { GalleryImage } from '@/components/event/hero-gallery';
import {
  fetchEventContentSafe,
  fetchEventDetail,
  fetchEventTiers,
  fetchEventsSafe,
} from '@/lib/api/events';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong, formatEventTime } from '@/lib/discovery/format';
import { availabilityLabel, isUrgent, summariseTiers } from '@/lib/discovery/tiers';
import { JsonLd, breadcrumbJsonLd, eventJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL, pageMetadata } from '@/lib/seo/metadata';
import { cn } from '@/lib/utils/cn';

/**
 * The event page — the conversion surface.
 *
 * It answers, in this order and within a screen or two: what is this, when is
 * it, is it going, what does it cost, who is running it, where is it, and what
 * happens after I pay. The order IS the argument: photograph and title first,
 * because that's what makes someone want it; then the facts that decide
 * feasibility; then price; and only then the long-form detail nobody reads
 * until they're already interested.
 *
 * RENDERING is split by how fresh each part has to be:
 *
 * - Everything descriptive (title, photo, facts, description, organiser, venue,
 *   policies) is server-rendered. It's identical for every visitor.
 * - INVENTORY IS NOT CACHED. Tiers are fetched `no-store` on every request and
 *   re-verified in the browser. It is the one number here where being stale
 *   costs money in both directions — selling a ticket that doesn't exist, or
 *   turning away someone who could have bought one. That's also why the route
 *   is `force-dynamic`: ISR'ing the page would ISR the tier read with it.
 *
 * The only client islands are tier selection, the lightbox, share and save.
 * Everything else ships no JavaScript.
 *
 * LIGHT-FIRST, IMAGE-FORWARD. The photograph is the only colour above the fold;
 * everything around it is white, hairlines and ink. There is exactly ONE filled
 * control on the page — the black "Book tickets" pill in the ticket panel (and
 * its mobile twin, which scrolls to that same panel rather than being a second
 * checkout). Share, Add to calendar, Save, Their other events and Directions
 * are all hairline pills at the 44px touch floor, so none of them competes with
 * the decision. The wayfinding violet is spent in exactly three places: the
 * event DATE under the title, the countdown's tint, and the map pin.
 */
export const dynamic = 'force-dynamic';

async function getEvent(id: string): Promise<EventDetail | null> {
  try {
    return await fetchEventDetail(id);
  } catch {
    return null;
  }
}

async function getTiers(id: string): Promise<TicketTier[]> {
  try {
    return (await fetchEventTiers(id)).data;
  } catch {
    // A failed tier read must not take the page down — the event is still worth
    // showing, and the panel has a state for "not published yet".
    return [];
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const event = await getEvent(params.id);
  if (!event) return pageMetadata('Event not found');
  // The organizer's own SEO copy wins when they wrote it; otherwise the
  // derived line, which is built from real columns and never invented. The
  // Studio's search preview applies exactly this fallback, so what an
  // organizer sees while typing is what Google gets.
  const derived = `${event.title} at ${event.venue}, ${event.city} — ${formatEventDateLong(event.starts_at)}.`;
  const title = event.seo_title?.trim() || event.title;
  const description = event.seo_description?.trim() || event.short_description?.trim() || derived;
  return {
    ...pageMetadata(title, description),
    alternates: { canonical: `/events/${event.id}` },
    openGraph: {
      title,
      description,
      ...(event.poster_url ? { images: [{ url: event.poster_url }] } : {}),
    },
  };
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  // All three reads only need the id from the URL, so they go out together
  // rather than one after another — on a slow link that's two whole round trips
  // off the time to first byte, and this route is `force-dynamic`, so it's paid
  // on every request. `fetchEventContentSafe` never throws, so a blip in the
  // below-the-fold enrichment cannot take down the buy button.
  const [event, tiers, content] = await Promise.all([
    getEvent(params.id),
    getTiers(params.id),
    fetchEventContentSafe(params.id),
  ]);
  if (!event) notFound();

  const category = inferCategory(event);
  const summary = summariseTiers(tiers);
  const availability = availabilityLabel(summary.state);
  const url = `${SITE_URL}/events/${event.id}`;

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
      <JsonLd
        data={eventJsonLd({
          name: event.title,
          startDate: event.starts_at,
          endDate: event.ends_at ?? undefined,
          url,
          locationName: event.venue,
          city: event.city,
          image: event.poster_url || undefined,
          description: event.description || undefined,
          priceMinor: summary.fromPrice ?? event.from_price,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd(
          crumbs.map((crumb) => ({
            name: crumb.label,
            url: crumb.href ? `${SITE_URL}${crumb.href}` : url,
          })),
        )}
      />

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
            </div>

            <Countdown startsAt={event.starts_at} />
          </div>

          {/* `lg:top-sticky-top-lg` is the header's own height plus a rung of
              breathing room, derived rather than the hard-coded 80px it was —
              which had already drifted from a 72px header. */}
          <div className="lg:sticky lg:top-sticky-top-lg lg:col-start-2 lg:row-start-1">
            <TicketPanel eventId={event.id} initialTiers={tiers} />
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

        {/* The related row needs a SECOND round trip (it can only be queried
            once the event's city is known), and nothing above it depends on the
            answer. Streaming it behind its own boundary means the decision —
            title, photo, price, availability — is never waiting on a
            recommendation. The fallback reserves the row's height, so it can't
            shift the footer when it lands. */}
        <Suspense fallback={<RelatedFallback city={event.city} />}>
          <RelatedEvents city={event.city} excludeId={event.id} />
        </Suspense>
      </Container>

      {/* Mobile only, and only once the panel above has scrolled away. */}
      <BookingBar eventId={event.id} initialTiers={tiers} />
    </>
  );
}

function RelatedShell({ city, children }: { city: string; children: React.ReactNode }) {
  return (
    <section className="flex min-h-[26rem] flex-col gap-6 border-t border-border pt-10">
      <div className="flex items-end justify-between gap-4">
        <SectionHeading>More in {city}</SectionHeading>
        <Link
          href={`/events?city=${encodeURIComponent(city)}`}
          className="shrink-0 rounded-full text-label text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          See all
        </Link>
      </div>
      {children}
    </section>
  );
}

function RelatedFallback({ city }: { city: string }) {
  return (
    <RelatedShell city={city}>
      <EventGridSkeleton count={3} />
    </RelatedShell>
  );
}

async function RelatedEvents({ city, excludeId }: { city: string; excludeId: string }) {
  const related = await fetchEventsSafe({ city, page_size: 7 });
  const others = related.events.filter((other) => other.id !== excludeId).slice(0, 3);
  if (!others.length) return null;
  return (
    <RelatedShell city={city}>
      <EventGrid events={others} />
    </RelatedShell>
  );
}
