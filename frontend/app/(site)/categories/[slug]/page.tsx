import * as React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/shell/container';
import { categoryTint } from '@/components/discovery/category-tint';
import { EventGrid } from '@/components/discovery/event-grid';
import { RowEmpty, RowError } from '@/components/discovery/row-states';
import { ClayIcon } from '@/components/illustrations/clay';
import { PUBLIC_LIST_REVALIDATE_SECONDS, fetchEventsSafe } from '@/lib/api/events';
import { CATEGORIES, categoryBySlug } from '@/lib/discovery/categories';
import { browseHref } from '@/lib/discovery/filters';
import { cn } from '@/lib/utils/cn';
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

      <header className="flex flex-col gap-4">
        {/* ONE SOURCE OF TRUTH FOR WHAT A CATEGORY LOOKS LIKE. This was a 48px
            square painted with the category's raw violet/pink gradient and a
            thin lucide glyph on top — the only place in the product still
            putting a line icon on a brand gradient, and it contradicted the
            clay set used on the tiles the visitor just pressed to get here. It
            is the same artwork on the same pastel plate now, resolved from the
            same slug, so the tile and the page it opens agree. */}
        <span
          className={cn(
            'inline-flex size-14 items-center justify-center rounded-2xl',
            categoryTint(category.slug).surface,
          )}
          aria-hidden
        >
          <ClayIcon slug={category.slug} className="size-10" />
        </span>
        <h1 className="text-h1">{category.label} events</h1>
        <p className="max-w-2xl text-body-lg text-muted-foreground">{category.blurb}.</p>
        <div>
          <Button asChild>
            <Link href={browse}>
              Filter by date, city and price
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
          title={`No ${category.label.toLowerCase()} events yet`}
          description="Nothing in this category is on sale right now. Try another category or a nearby city."
          ctaLabel="Browse all events"
          ctaHref="/events"
        />
      )}
    </Container>
  );
}
