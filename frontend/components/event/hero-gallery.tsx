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
 * ── ONE FRAME, AND WHY IT IS FIXED AT 16:9 ────────────────────────────────
 *
 * Three attempts came before this one and each fixed the last one's failure
 * while introducing its own. They are worth naming, because the fourth answer
 * is not obvious from the first three:
 *
 *   1. `object-cover` in a 4:3 box CROPPED a portrait poster's top and bottom.
 *   2. `object-contain` in a 16:9 box did not crop and made the poster tiny —
 *      a strip of picture between two wide blurred bars.
 *   3. A frame that TOOK THE PICTURE'S OWN SHAPE fixed both, and broke the
 *      page: sized by height with `w-auto`, a landscape image resolved to
 *      917px wide inside a 352px column and ran straight over the event's
 *      title. Measured, not guessed — the h1 sat at x=520 under an image
 *      spanning x=105 to x=1022.
 *
 * The third attempt was wrong in principle, not just in its clamp. A page
 * whose frame changes shape per event has no layout — every event page is a
 * different page, the filmstrip below never lines up, and no column can be
 * sized because nothing knows how tall the picture will be.
 *
 * So the frame is FIXED at 16:9 and the pictures are required to be that
 * shape, which is what every serious platform does: Eventbrite pins
 * 2160x1080 and tells designers to centre the artwork so it survives the
 * crop, Luma pins square at 800 minimum, Skiddle pins square at 800-1024 and
 * publishes that 95% of its rejections are text, crop and resolution. The
 * door is `core.uploads.EVENT_IMAGE_SPEC`; this is the frame it exists for.
 *
 * `object-cover`, therefore, and not `contain`: inside the accepted band
 * there is nothing to letterbox, and a conforming image fills the frame
 * exactly. Images stored before the gate existed are cropped rather than
 * shrunk — the lightbox is one press away and shows them whole.
 *
 * NO LAYOUT SHIFT falls out of it: the height is known from the width before
 * a byte arrives, on every event, forever.
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
  hideMainImage = false,
  className,
}: {
  images: GalleryImage[];
  /** Drives the placeholder artwork AND its pastel tint when the event has no
   *  media at all. */
  categorySlug?: string;
  priority?: boolean;
  hideMainImage?: boolean;
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
        {/* 16:9, always. See the note at the top of this file for the three
            shapes that came before it and what each one broke. */}
        {!hideMainImage ? (
          <div
            onClick={() => current && setOpen(true)}
            className={cn(
              'group/hero relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted',
              current && 'cursor-pointer',
            )}
          >
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
              /* No blurred backdrop any more. It existed to fill the bars a
                 contained picture left behind, and a conforming image leaves
                 none — so it was a second full-size decode of the same file,
                 on the LCP element, for nothing. */
              <Image
                src={current.url}
                alt={current.alt}
                fill
                priority={priority}
                sizes="(min-width: 1024px) 832px, 100vw"
                className="object-cover"
              />
            ) : null}

            {/* Prev/next ON the image. The filmstrip below already changes the
                picture, but a strip is a jump-to control — stepping through in
                order is the gesture people arrive with, and on a phone there is
                no filmstrip visible without scrolling the row. */}
            {images.length > 1 ? (
              <>
                {/* The same control the lightbox uses. `glass-media` is the one
                    treatment that stays dark in both themes, which is what it
                    has to do when what is behind it is an arbitrary photograph. */}
                <LightboxArrow side="left" onClick={() => step(-1)} />
                <LightboxArrow side="right" onClick={() => step(1)} />
              </>
            ) : null}

            {current ? (
              <button
                ref={openerRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(true);
                }}
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
        ) : null}

        {images.length > 0 && (hideMainImage || images.length > 1) ? (
          <ul className="flex flex-wrap gap-2 overflow-x-auto pb-1">
            {images.map((image, position) => (
              // Keyed by POSITION as well as url. Two `EventMedia` rows may
              // legitimately point at the same stored object — an organiser
              // adding the same photograph to a gallery twice, or a duplicated
              // event whose media was copied — and a bare url key then throws
              // "Encountered two children with the same key", after which React
              // may drop or duplicate a thumbnail.
              <li key={`${image.url}#${position}`} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIndex(position);
                    setOpen(true);
                  }}
                  aria-label={image.alt || `Photo ${position + 1}`}
                  aria-current={position === safeIndex}
                  className={cn(
                    // 16:9 like the frame it drives. Clear, unblurred thumbnail cards.
                    'relative block aspect-video w-24 overflow-hidden rounded-lg border transition sm:w-28 opacity-100 hover:scale-105',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    position === safeIndex
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  {/* Empty alt: the button already carries the description, and
                      repeating it here would announce every photo twice. */}
                  <Image src={image.url} alt="" fill sizes="112px" className="object-cover" />
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
            {/* `contain` HERE, and cover on the page — the two are doing
                different jobs. The page frame is a layout that has to be one
                shape on every event; the lightbox is somebody asking to see
                the picture, so it shows all of it, including the parts a
                pre-gate image loses to the frame's crop. */}
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-overlay">
              <Image
                src={current.url}
                alt={current.alt}
                fill
                sizes="(min-width: 1024px) 900px, 100vw"
                className="object-contain"
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

function LightboxArrow({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: (e: React.MouseEvent) => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
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
