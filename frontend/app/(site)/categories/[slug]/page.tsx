import * as React from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { EventGrid } from '@/components/discovery/event-grid';
import { RowEmpty, RowError } from '@/components/discovery/row-states';
import { CategoryHero } from '@/components/discovery/category-hero';
import { PUBLIC_LIST_REVALIDATE_SECONDS, fetchEventsSafe } from '@/lib/api/events';
import { CATEGORIES, categoryBySlug } from '@/lib/discovery/categories';
import { browseHref } from '@/lib/discovery/filters';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, breadcrumbJsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL, pageMetadata } from '@/lib/seo/metadata';

/**
 * Category landing page — STATIC + ISR, one per category, prerendered at build.
 * These are the pages that should rank: a stable URL, one clear subject, real
 * events on them, and an ItemList + BreadcrumbList for the crawler. The
 * interactive browse surface is one link away.
 */
export const revalidate = PUBLIC_LIST_REVALIDATE_SECONDS;

export function generateStaticParams() {
  return CATEGORIES.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const category = categoryBySlug(params.slug);
  if (!category) return {};
  return {
    ...pageMetadata(
      `${category.label} events`,
      `${category.blurb}. Browse upcoming ${category.label.toLowerCase()} events by date, city and price.`,
    ),
    alternates: { canonical: `/categories/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const category = categoryBySlug(params.slug);
  if (!category) notFound();

  const { events, error } = await fetchEventsSafe({ q: category.query, page_size: 20 });
  const browse = browseHref({ category: category.slug });

  return (
    <Container className="flex flex-col gap-8 py-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', url: SITE_URL },
          { name: 'Categories', url: `${SITE_URL}/events` },
          { name: category.label, url: `${SITE_URL}/categories/${category.slug}` },
        ])}
      />
      {events.length ? (
        <JsonLd data={eventItemListJsonLd(`${category.label} events`, events.map(eventToJsonLd))} />
      ) : null}

      <CategoryHero
        slug={category.slug}
        label={`${category.label} events`}
        browseHref={browse}
        count={events.length || undefined}
      />

      {error ? (
        <RowError message={error} retryHref={browse} />
      ) : events.length ? (
        <EventGrid events={events} priorityCount={4} />
      ) : (
        <RowEmpty
          title={`No ${category.label.toLowerCase()} events yet`}
          description="Nothing in this category is on sale right now. Try another category or a nearby city."
          ctaLabel="Browse all events"
          ctaHref="/events"
        />
      )}
    </Container>
  );
}
