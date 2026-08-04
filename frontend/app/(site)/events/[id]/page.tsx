import * as React from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { EventGrid, EventGridSkeleton } from '@/components/discovery/event-grid';
import { EventPageBody } from '@/components/event/event-page-body';
import { SectionHeading } from '@/components/event/sections';
import {
  fetchEventContentSafe,
  fetchEventDetail,
  fetchEventTiers,
  fetchEventsSafe,
} from '@/lib/api/events';
import type { EventDetail, TicketTier } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDateLong } from '@/lib/discovery/format';
import { summariseTiers } from '@/lib/discovery/tiers';
import { JsonLd, breadcrumbJsonLd, eventJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL, pageMetadata } from '@/lib/seo/metadata';

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
  const url = `${SITE_URL}/events/${event.id}`;

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

      {/* The page body is a COMPONENT, and the Studio's preview renders the
          very same one from the local draft — so there is no second layout to
          keep in sync and no way for the preview to promise a page that will
          not appear. `related` is passed as a slot because it is an async
          server component that streams behind its own boundary. */}
      <EventPageBody
        event={event}
        tiers={tiers}
        content={content}
        related={
          /* The related row needs a SECOND round trip (it can only be queried
             once the event's city is known), and nothing above it depends on
             the answer. Streaming it behind its own boundary means the
             decision — title, photo, price, availability — is never waiting on
             a recommendation. The fallback reserves the row's height, so it
             can't shift the footer when it lands. */
          <Suspense fallback={<RelatedFallback city={event.city} />}>
            <RelatedEvents city={event.city} excludeId={event.id} />
          </Suspense>
        }
      />
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
