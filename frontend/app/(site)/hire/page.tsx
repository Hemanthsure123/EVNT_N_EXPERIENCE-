import * as React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { Marketplace } from '@/components/hire/marketplace';
import { SpotHireABand } from '@/components/illustrations/spots';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = {
  ...pageMetadata(
    'Hire a band, DJ or performer',
    'Bands, DJs, singers, comedians, anchors and dance crews for weddings, birthdays, corporate events and festivals. Post one brief and every act that fits answers it.',
  ),
  alternates: { canonical: '/hire' },
};

/**
 * The marketplace.
 *
 * `Marketplace` reads its filters from `useSearchParams`, which needs a
 * Suspense boundary or the whole route becomes client-rendered at request
 * time. The boundary keeps the heading static and defers only the grid.
 */
export default function HirePage() {
  return (
    <Container className="flex flex-col gap-6 py-8 sm:gap-10 lg:py-14">
      {/* The illustration sits BESIDE the copy, not above it: on a phone a
          stacked hero and a 40px heading pushed the first act below the fold,
          which on an index page is the whole point of the screen. */}
      <header className="flex items-center gap-4 sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3 lg:max-w-2xl">
          <h1 className="text-h3 sm:text-h2 lg:text-h1">Hire a performer</h1>
          <p className="text-body-sm text-muted-foreground sm:text-body lg:text-body-lg">
            Bands, DJs, singers, comedians and more — for weddings, birthdays, corporate evenings
            and festivals. Every act here has been reviewed before it was listed.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/hire/new"
              className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Post a brief
            </Link>
            <Link
              href="/hire/requests"
              className="inline-flex h-control items-center rounded-full border border-border px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Your briefs
            </Link>
          </div>
        </div>

        <SpotHireABand className="hidden h-24 w-auto shrink-0 sm:block lg:h-36" />
      </header>

      <React.Suspense fallback={<div className="skeleton h-96 w-full rounded-2xl" aria-hidden />}>
        <Marketplace />
      </React.Suspense>
    </Container>
  );
}
