import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/shell/container';
import { EventGrid } from '@/components/discovery/event-grid';
import { RowEmpty, RowError } from '@/components/discovery/row-states';
import { PUBLIC_LIST_REVALIDATE_SECONDS, fetchEventsSafe } from '@/lib/api/events';
import { POPULAR_CITIES, cityBySlug } from '@/lib/discovery/cities';
import { browseHref } from '@/lib/discovery/filters';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, breadcrumbJsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL, pageMetadata } from '@/lib/seo/metadata';

/** City landing page — STATIC + ISR, prerendered for every served city. */
export const revalidate = PUBLIC_LIST_REVALIDATE_SECONDS;

export function generateStaticParams() {
  return POPULAR_CITIES.map((city) => ({ city: city.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { city: string };
}): Promise<Metadata> {
  const city = cityBySlug(params.city);
  if (!city) return {};
  return {
    ...pageMetadata(
      `Events in ${city.name}`,
      `${city.blurb} — everything on sale in ${city.name}, by date, venue and price.`,
    ),
    alternates: { canonical: `/cities/${city.slug}` },
  };
}

export default async function CityPage({ params }: { params: { city: string } }) {
  const city = cityBySlug(params.city);
  if (!city) notFound();

  const { events, error } = await fetchEventsSafe({ city: city.name, page_size: 20 });
  const browse = browseHref({ city: city.name });

  return (
    <Container className="flex flex-col gap-8 py-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', url: SITE_URL },
          { name: 'Cities', url: `${SITE_URL}/cities` },
          { name: city.name, url: `${SITE_URL}/cities/${city.slug}` },
        ])}
      />
      {events.length ? (
        <JsonLd data={eventItemListJsonLd(`Events in ${city.name}`, events.map(eventToJsonLd))} />
      ) : null}

      <header className="flex flex-col gap-4">
        {/* Warm cream with dark ink, not the old violet-100 tint: violet is
            wayfinding-only now, and "which city am I in" is a place marker
            rather than a call to action. */}
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-nav-active text-nav-active-foreground">
          <MapPin className="size-7" aria-hidden />
        </span>
        <h1 className="text-h1">Events in {city.name}</h1>
        <p className="max-w-2xl text-body-lg text-muted-foreground">{city.blurb}.</p>
        <div>
          <Button asChild>
            <Link href={browse}>
              Filter by date, category and price
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </header>

      {error ? (
        <RowError message={error} retryHref={browse} />
      ) : events.length ? (
        <EventGrid events={events} priorityCount={4} />
      ) : (
        <RowEmpty
          title={`Nothing on in ${city.name} yet`}
          description="No events are on sale here right now. Try a nearby city — organizers publish every week."
          ctaLabel="See all cities"
          ctaHref="/cities"
        />
      )}
    </Container>
  );
}
