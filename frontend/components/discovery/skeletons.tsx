import * as React from 'react';
import { Container } from '@/components/shell/container';
import { cn } from '@/lib/utils/cn';

/**
 * Route-level loading screens.
 *
 * These are LOW-FIDELITY versions of the real page, not spinners. A spinner
 * says "wait" and nothing else; a skeleton in the real layout says what is
 * coming and where, so the eye can already start where the content will land —
 * and because the boxes are the same size as the content, nothing shifts when
 * it arrives.
 *
 * Every one of them is `aria-hidden` with a single polite "Loading" status, so
 * a screen reader hears one word instead of a wall of empty placeholders.
 */

/**
 * Widths are LITERAL class names, never built from a template: Tailwind scans
 * source text, so `w-${n}` produces a class that was never generated.
 * Uneven on purpose — a row of identical bars reads as a loading bar, whereas
 * varied ones read as the words that are coming.
 */
const CHIP_WIDTHS = ['w-20', 'w-32', 'w-24', 'w-28', 'w-16', 'w-24'];

function Bar({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/** One announcement for the whole screen. */
function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function SectionHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Bar className="h-0.5 w-10 rounded-full" />
      <Bar className="h-8 w-56" />
      <Bar className="h-4 w-72" />
    </div>
  );
}

/** The home page: hero split, mood grid, one content row. */
export function HomeSkeleton() {
  return (
    <>
      <LoadingAnnouncement label="Loading events" />
      <section className="border-b border-border" aria-hidden>
        {/* No `.hero-atmosphere` here any more. It was the loading state's copy
            of the hero's old violet aurora, so leaving it would flash a page
            that no longer exists for the whole of the wait. */}
        <Container className="flex flex-col gap-10 py-12 lg:py-16">
          <div className="grid gap-12 lg:grid-cols-[42fr_58fr] lg:items-center lg:gap-16">
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-5">
                <Bar className="h-4 w-28" />
                <Bar className="h-12 w-full max-w-md" />
                <Bar className="h-12 w-4/5 max-w-sm" />
                <Bar className="h-5 w-full max-w-lg" />
                <Bar className="h-5 w-3/4 max-w-md" />
              </div>
              <Bar className="h-14 w-full rounded-full" />
              <div className="flex flex-wrap gap-2">
                {CHIP_WIDTHS.slice(0, 5).map((w, i) => (
                  <Bar key={i} className={cn('h-control rounded-full', w)} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <Bar className="aspect-poster w-full rounded-2xl sm:aspect-feature" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Bar key={i} className={cn('h-16 rounded-xl', i === 2 && 'hidden sm:block')} />
                ))}
              </div>
            </div>
          </div>
        </Container>
      </section>

      <Container className="flex flex-col gap-8 py-section lg:py-section-lg" aria-hidden>
        <SectionHeaderSkeleton />
        {/* Category tiles are vertical now — label and blurb over a tinted
            plate — so the reserved box is a card, not a row. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Bar key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </Container>
    </>
  );
}

/**
 * Browse / search results: breadcrumb, header, banner, sticky toolbar, grid.
 *
 * Shaped to the real page rather than to a generic "list loading" pattern —
 * the banner block and the toolbar row are what make the wait read as THIS
 * page arriving, and they're what stop the header jumping when it does.
 */
export function ResultsSkeleton() {
  return (
    <div className="flex flex-col">
      <LoadingAnnouncement label="Loading events" />

      <Container className="flex flex-col gap-4 pb-8 pt-6" aria-hidden>
        <div className="flex items-center gap-2">
          <Bar className="h-4 w-12" />
          <Bar className="h-4 w-4 rounded-full" />
          <Bar className="h-4 w-20" />
        </div>
        <div className="flex flex-col gap-2">
          <Bar className="h-10 w-64" />
          <Bar className="h-5 w-full max-w-xl" />
        </div>
      </Container>

      <Container className="pb-8" aria-hidden>
        <div className="relative h-56 overflow-hidden rounded-2xl border border-border md:h-60">
          <div className="skeleton absolute inset-0" />
          {/* Matches the banner's `p-card-lg` (24px) / `md:p-8`. */}
          <div className="absolute inset-x-6 bottom-6 flex flex-col gap-4 md:inset-x-8 md:bottom-8">
            <Bar className="h-8 w-56" />
            <Bar className="h-4 w-72" />
            <div className="flex gap-2">
              {['w-24', 'w-20', 'w-24'].map((w, i) => (
                <Bar key={i} className={cn('h-8 rounded-full', w)} />
              ))}
            </div>
          </div>
        </div>
      </Container>

      <div className="border-y border-border" aria-hidden>
        <Container className="flex items-center gap-3 py-3">
          <Bar className="h-9 w-24 shrink-0 rounded-full" />
          <div className="flex flex-1 gap-2 overflow-hidden">
            {CHIP_WIDTHS.map((w, i) => (
              <Bar key={i} className={cn('h-9 shrink-0 rounded-full', w)} />
            ))}
          </div>
          <Bar className="h-9 w-36 shrink-0 rounded-full" />
          <Bar className="h-9 w-20 shrink-0 rounded-full" />
        </Container>
      </div>

      <Container className="py-section lg:py-section-lg" aria-hidden>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {Array.from({ length: 6 }, (_, i) => (
            <ResultCardSkeleton key={i} />
          ))}
        </div>
      </Container>
    </div>
  );
}

/**
 * Mirrors event-card.tsx exactly — a PORTRAIT poster with nothing composited on
 * it, then the meta row, body and price/arrow footer. The two have to move
 * together: a skeleton whose geometry has drifted from the card it stands in
 * for measured a 0.27 layout shift once (see `EventDetailSkeleton` below).
 */
function ResultCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md">
      <div className="skeleton aspect-portrait w-full" />
      <div className="flex flex-1 flex-col gap-2 p-card lg:p-card-lg">
        <Bar className="h-5 w-24 rounded-full" />
        <Bar className="h-5 w-11/12" />
        <Bar className="h-5 w-2/3" />
        <Bar className="mt-1 h-4 w-3/5" />
        <Bar className="h-4 w-4/5" />
        <Bar className="h-3 w-2/5" />
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4">
          <Bar className="h-6 w-20" />
          <Bar className="size-9 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** A city / category landing page: header block, then a grid. */
export function LandingSkeleton() {
  return (
    <Container className="flex flex-col gap-8 py-8">
      <LoadingAnnouncement label="Loading events" />
      {/* The medallion is the tinted plate carrying a clay icon now, and the
          CTA is a fully-rounded pill — both boxes match what actually lands. */}
      <div className="flex flex-col gap-4" aria-hidden>
        <Bar className="size-14 rounded-2xl" />
        <Bar className="h-10 w-72" />
        <Bar className="h-5 w-full max-w-lg" />
        <Bar className="h-11 w-64 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-xl border border-border">
            <Bar className="aspect-portrait w-full rounded-none" />
            <div className="flex flex-col gap-3 p-card">
              <Bar className="h-5 w-4/5" />
              <Bar className="h-4 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
}

/**
 * The event page placeholder.
 *
 * It is TALL on purpose. This route streams (it has a `loading.tsx`, which is an
 * implicit Suspense boundary), so this markup is what paints first and the real
 * page replaces it. A short skeleton therefore doesn't just look wrong — it puts
 * the footer on screen and then yanks it down when the content arrives, which
 * measured as a **0.27 layout shift**, nearly three times the entire budget.
 * Matching the real page's two-column shape and its section count is what makes
 * the swap invisible.
 */
export function EventDetailSkeleton() {
  return (
    <Container className="flex flex-col gap-8 py-6 lg:gap-10 lg:py-8">
      <LoadingAnnouncement label="Loading event" />

      <div className="flex items-center gap-2" aria-hidden>
        <Bar className="h-4 w-12" />
        <Bar className="h-4 w-16" />
        <Bar className="h-4 w-40" />
      </div>

      <div
        className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12"
        aria-hidden
      >
        <div className="flex min-w-0 flex-col gap-6">
          <Bar className="aspect-feature w-full rounded-2xl" />
          <div className="flex flex-col gap-4">
            <Bar className="h-7 w-28 rounded-full" />
            <Bar className="h-11 w-full max-w-lg" />
            <Bar className="h-5 w-3/4 max-w-md" />
            <div className="flex gap-2">
              <Bar className="h-10 w-24 rounded-full" />
              <Bar className="h-10 w-10 rounded-full" />
            </div>
          </div>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Bar key={i} className="h-16 w-14 rounded-lg" />
            ))}
          </div>
        </div>

        {/* The ticket panel: the tallest single block on the page. */}
        <Bar className="h-[30rem] w-full rounded-2xl" />

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1">
          {[0, 1, 2, 3].map((section) => (
            <div key={section} className="flex flex-col gap-4">
              <Bar className="h-7 w-48" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Bar className="h-20 rounded-xl" />
                <Bar className="h-20 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
