'use client';

import * as React from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { ClayIcon } from '@/components/illustrations/clay';
import { cn } from '@/lib/utils/cn';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';

/**
 * The event's photographs, and a lightbox for looking at them properly.
 *
 * THE PHOTOGRAPH IS THE ONLY COLOUR ON THE FIRST SCREEN. In the light-first
 * language the page around it is white and quiet, so this frame carries no
 * gradient wash, no vignette and no tint of its own — just a hairline, a card
 * radius, and the picture. The single control that has to live ON the image
 * (open full size) keeps `.glass-media`, which is the one treatment that stays
 * dark in both themes because what is behind it is an arbitrary photo.
 *
 * ONE IMAGE OR MANY, decided by what the organiser actually uploaded. The
 * filmstrip appears only from the second image — a strip of one thumbnail is
 * chrome around nothing.
 *
 * NO LAYOUT SHIFT: the frame is a fixed `aspect-feature` box with the image as
 * `fill`, so its height is known before the bytes arrive. The box paints a
 * neutral token ramp underneath, which is the blur-up — the photo replaces it
 * as it decodes, without shipping a second encoded placeholder per page.
 *
 * NO PHOTO IS A DESIGN STATE, NOT A HOLE, and it is no longer a brand gradient.
 * Most events in this catalogue have no media, so on mobile this box is the
 * largest single element on the conversion page. It now paints the CATEGORY'S
 * PASTEL TINT (`--tint-<slug>`, the same pastel the category tiles sit their
 * clay icon on) behind that category's clay icon — so a poster-less event reads
 * as a designed card rather than as the only violet-and-pink surface left on a
 * white page. The tint is keyed off the SLUG, which is what both the CMS
 * payload and the bundled category list agree on.
 *
 * ONLY THE FIRST IMAGE IS `priority`. Marking a whole gallery high-priority
 * makes every one of them compete for the same connections and delays the LCP
 * element they were meant to help.
 *
 * The lightbox is NOT a Radix dialog. It's ~20 lines with the same three
 * behaviours (Escape, outside click, focus trap via the shared helper) and
 * without modal mode's document-wide style invalidation, which cost this app a
 * second of INP everywhere it was used. It also mounts nothing until opened, so
 * it costs the page zero until someone asks for it.
 */

export type GalleryImage = {
  url: string;
  /** Describes the picture. On this page the image IS content, unlike on a
   *  card where the heading beside it already says what the event is. */
  alt: string;
};

/**
 * Slug -> pastel tint class. Written out rather than interpolated because
 * Tailwind only ships classes it can see in the source; a template literal
 * would compile to nothing. Mirrors `CategorySlug` and the `--tint-*` pairs in
 * tokens.css. An unknown slug falls back to the neutral recessed well, never to
 * a colour picked at random.
 */
const CATEGORY_TINT: Record<string, string> = {
  concerts: 'bg-tint-concerts',
  comedy: 'bg-tint-comedy',
  workshops: 'bg-tint-workshops',
  sports: 'bg-tint-sports',
  festivals: 'bg-tint-festivals',
  nightlife: 'bg-tint-nightlife',
  'food-drink': 'bg-tint-food-drink',
  tech: 'bg-tint-tech',
};

export function HeroGallery({
  images,
  categorySlug,
  priority = true,
  className,
}: {
  images: GalleryImage[];
  /** Drives the placeholder artwork AND its pastel tint when the event has no
   *  media at all. */
  categorySlug?: string;
  priority?: boolean;
  className?: string;
}) {
  const [index, setIndex] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  useBackgroundInert(open);

  // Clamped rather than trusted: the list can shrink between renders (a
  // revalidation that drops a deleted image), and an out-of-range index would
  // render nothing at all where the photograph should be.
  const safeIndex = Math.min(index, Math.max(images.length - 1, 0));
  const current = images[safeIndex] ?? null;

  const step = React.useCallback(
    (delta: number) =>
      setIndex((previous) => (previous + delta + images.length) % Math.max(images.length, 1)),
    [images.length],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      // Arrow keys move through the gallery while the lightbox is open — what
      // every image viewer does, and what a keyboard user will try first.
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    // Focus moves in on open and returns to the trigger on close. The opener is
    // captured now, not read in the cleanup — by then the ref may point
    // somewhere else, and focus would land on the wrong control or nowhere.
    const opener = openerRef.current;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [open, step]);

  return (
    <>
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="group/hero relative aspect-feature w-full overflow-hidden rounded-xl border border-border bg-muted">
          <div className="absolute inset-0 bg-gradient-to-br from-muted to-border" aria-hidden />
          {!current ? (
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center',
                CATEGORY_TINT[categorySlug ?? ''] ?? 'bg-sunken',
              )}
              aria-hidden
            >
              <ClayIcon slug={categorySlug ?? ''} className="size-24 drop-shadow-lg" />
            </div>
          ) : null}
          {current ? (
            <Image
              src={current.url}
              alt={current.alt}
              fill
              priority={priority}
              sizes="(min-width: 1024px) 800px, 100vw"
              className="object-cover"
            />
          ) : null}

          {current ? (
            <button
              ref={openerRef}
              type="button"
              onClick={() => setOpen(true)}
              aria-label={
                images.length > 1
                  ? `View all ${images.length} photos full size`
                  : 'View photo full size'
              }
              className={cn(
                'glass-media absolute bottom-4 right-4 inline-flex h-control items-center gap-2 rounded-full border px-pill text-label text-on-gradient shadow-sm',
                'transition duration-fast ease-out hover:scale-105 active:scale-95',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <Expand className="size-4" aria-hidden />
              {images.length > 1 ? `${images.length} photos` : 'View photo'}
            </button>
          ) : null}
        </div>

        {images.length > 1 ? (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {images.map((image, position) => (
              <li key={image.url} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={image.alt || `Photo ${position + 1}`}
                  aria-current={position === safeIndex}
                  className={cn(
                    'relative block size-16 overflow-hidden rounded-lg border transition sm:size-20',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    // A selected hairline is one of the two sanctioned uses of
                    // the wayfinding violet, and the ring is what makes it
                    // survive being a 1px edge next to a busy photograph.
                    position === safeIndex
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border opacity-70 hover:opacity-100',
                  )}
                >
                  {/* Empty alt: the button already carries the description, and
                      repeating it here would announce every photo twice. */}
                  <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {open && current ? (
        <div
          className="fixed inset-0 z-modal flex items-center justify-center bg-overlay/90 p-4 animate-in fade-in-0"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={current.alt}
            tabIndex={-1}
            onKeyDown={(event) => trapTab(event, panelRef.current)}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-full w-full max-w-4xl flex-col gap-3 outline-none"
          >
            <div className="relative aspect-feature w-full overflow-hidden rounded-2xl bg-muted">
              <Image
                src={current.url}
                alt={current.alt}
                fill
                sizes="(min-width: 1024px) 900px, 100vw"
                priority
              />
              {images.length > 1 ? (
                <>
                  <LightboxArrow side="left" onClick={() => step(-1)} />
                  <LightboxArrow side="right" onClick={() => step(1)} />
                </>
              ) : null}
            </div>

            <div className="flex flex-col items-center gap-2">
              {/* The organiser's alt text, shown rather than hidden: it is the
                  closest thing to a caption the API stores, and a sighted
                  visitor looking at a crowd shot benefits from "the main stage
                  at dusk" too. */}
              {current.alt ? (
                <p className="max-w-2xl text-center text-body-sm text-on-gradient">{current.alt}</p>
              ) : null}
              {images.length > 1 ? (
                <p aria-live="polite" className="text-caption tabular-nums text-on-gradient">
                  {safeIndex + 1} of {images.length}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="glass-media inline-flex h-control w-fit items-center gap-2 rounded-full border px-pill text-label text-on-gradient focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden />
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function LightboxArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={cn(
        'glass-media absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border text-on-gradient',
        'transition duration-fast hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
