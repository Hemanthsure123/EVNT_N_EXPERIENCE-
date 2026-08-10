import * as React from 'react';
import Image from 'next/image';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb';
import { ResultsView } from '@/components/discovery/results-view';
import { fetchEventsSafe } from '@/lib/api/events';
import { categoryBySlug } from '@/lib/discovery/categories';
import {
  type DiscoveryFilters,
  WHEN_LABELS,
  filtersFromSearchParams,
  toServerQuery,
} from '@/lib/discovery/filters';
import { eventToJsonLd } from '@/lib/discovery/seo';
import { JsonLd, eventItemListJsonLd } from '@/lib/seo/json-ld';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * Browse / search results.
 *
 * Dynamic by definition (it reads `searchParams`), but NOT slow: the first page
 * is fetched on the server through the Next data cache, which revalidates on
 * the same 30s clock as the backend's own `s-maxage`. So two people who open
 * the same filter combination within that window share one backend query, and
 * the HTML arrives with real cards in it rather than a spinner.
 *
 * This route renders what is the SAME for everyone with these filters —
 * breadcrumb, title, and the banner's photograph — and hands the rest to
 * `ResultsView`, which owns everything that changes as the user filters. That
 * split is what lets the banner's artwork sit in the initial HTML while the
 * live result count stays client-side.
 *
 * THE PAGE STATES ITS SUBJECT ONCE. It used to say it four times before the
 * first card — a breadcrumb, this `h1`, a two-line standfirst underneath it,
 * and then a banner headline restating the `h1` again — which on a 390px phone
 * put the first event about a screen and a half down. The `h1` is the one that
 * stays. `describe()` still returns `description`, because it is exactly what a
 * `<meta name="description">` and an `og:description` want: a sentence written
 * for somebody who has NOT arrived yet. Repeating it to somebody who is already
 * looking at the results is the part that was never earning its height.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function describe(filters: DiscoveryFilters): {
  title: string;
  /** METADATA ONLY — `<meta name="description">`. Never rendered on the page. */
  description: string;
  /** The banner's small scope line — never the same string as the h1. */
  bannerEyebrow: string;
  /** The banner's statement: what this scope IS, not what it's called. */
  bannerHeadline?: string;
  indexable: boolean;
} {
  const category = categoryBySlug(filters.category);
  const parts: string[] = [category ? category.label : 'Events'];
  if (filters.city) parts.push(`in ${filters.city}`);
  if (filters.when) parts.push(WHEN_LABELS[filters.when].toLowerCase());

  const title = filters.q ? `Search: ${filters.q}` : parts.join(' ');
  return {
    title,
    description: filters.q
      ? `Events matching “${filters.q}”. Browse dates, venues and prices, and book in seconds.`
      : `Browse ${parts.join(' ').toLowerCase()} — dates, venues and prices at a glance. No account needed to browse.`,
    bannerEyebrow: [category?.label ?? 'All events', filters.city].filter(Boolean).join(' · '),
    // A CATEGORY has something to say about itself ("Arenas, amphitheatres and
    // intimate gigs") and keeps its line. The unfiltered list does not: "every
    // upcoming event, soonest first" restates the ordering the page already
    // applies, under a heading that already says All events. With a real
    // photograph behind it the band needs no sentence to justify itself.
    bannerHeadline: category?.blurb,
    // A free-text search page is thin, near-duplicate content: crawl the links,
    // don't index the page.
    indexable: !filters.q,
  };
}

function breadcrumbs(filters: DiscoveryFilters, title: string): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [{ label: 'Home', href: '/' }];
  if (filters.city) {
    trail.push({ label: filters.city, href: `/cities/${filters.city.toLowerCase()}` });
  }
  if (filters.category) {
    const category = categoryBySlug(filters.category);
    if (category) trail.push({ label: category.label, href: `/categories/${category.slug}` });
  }
  // The last crumb is always the page you're on, and is never a link — so a
  // trail that would otherwise end on a link gets the current view appended.
  if (trail.length === 1 || filters.q || filters.when) trail.push({ label: title });
  return trail;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { title, description, indexable } = describe(filtersFromSearchParams(searchParams));
  return {
    ...pageMetadata(title, description),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = filtersFromSearchParams(searchParams);
  const query = toServerQuery(filters);
  const { events, next, error } = await fetchEventsSafe({ ...query, page_size: 20 });
  const { title, bannerEyebrow, bannerHeadline, indexable } = describe(filters);

  // The banner's photograph is the top result's own poster — a real image of
  // something actually on this page, rather than stock. See category-banner.tsx.
  const backdrop = events[0]?.poster_url ? (
    <Image
      src={events[0].poster_url}
      alt=""
      fill
      // It's blurred under a heavy scrim, so a small source is plenty — asking
      // for a full-width hero render here would be pure waste. And below `md`
      // the banner is `display:none` (results-view.tsx), so the media condition
      // resolves the preload to the smallest candidate in the srcset instead of
      // a poster nobody on a phone will ever see. `priority` stays: on desktop
      // the photograph is above the fold and this is still its preload.
      sizes="(min-width: 768px) 640px, 1px"
      priority
      className="object-cover"
    />
  ) : null;

  return (
    <div className="flex flex-col">
      {indexable && events.length ? (
        <JsonLd data={eventItemListJsonLd(title, events.map(eventToJsonLd))} />
      ) : null}

      {/* The `description` is deliberately NOT rendered — it goes to
          `generateMetadata` only. See the note at the top of this file. */}
      <Container className="flex flex-col gap-stack pb-block pt-block">
        <Breadcrumb items={breadcrumbs(filters, title)} />
        <h1 className="text-h2 md:text-h1">{title}</h1>
      </Container>

      <ResultsView
        initialFilters={filters}
        initialQuery={query}
        initialEvents={events}
        initialNext={next}
        initialError={error}
        bannerEyebrow={bannerEyebrow}
        bannerHeadline={bannerHeadline}
        bannerBackdrop={backdrop}
      />
    </div>
  );
}
