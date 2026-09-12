'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils/cn';
import { Play } from 'lucide-react';
import { Lightbox, type LightboxImage } from './lightbox';

/**
 * The event's photographs, as a masonry-style grid.
 *
 * ── WHAT IT REPLACED, AND WHY ─────────────────────────────────────────────
 *
 * A horizontally scrolling strip of equal 16:9 thumbnails. Every picture got
 * the same weight and the same shape, so a gallery of six read as a filmstrip
 * of contact prints — and on a phone the row ran off the edge, which meant the
 * only way to know how many there were was to scroll to the end.
 *
 * One large picture with smaller ones packed beside it is what every venue and
 * listing app does, and it does two things a strip cannot: it gives the best
 * photograph the space to be looked at, and it shows the SHAPE of the
 * collection — you can see at a glance that there are six, or that there are
 * more than six.
 *
 * ── THE GRID IS FIXED, THE CONTENT IS NOT ─────────────────────────────────
 *
 * Three columns. The first image spans two of them and two rows; the next two
 * stack down the right; three more fill the row beneath. That is SIX tiles, and
 * six is not arbitrary — it is what fits above the fold on a phone beside a
 * heading, and the point past which another row of thumbnails is a scroll
 * rather than a glance.
 *
 * Anything past the sixth is counted on the last tile (`+4`) rather than
 * hidden. A gallery that silently shows six of ten is lying about what the
 * organiser uploaded; a tile that says so is an invitation.
 *
 * With fewer than six the grid simply has fewer tiles — the spans are declared
 * per position, so a gallery of two is one large picture and one beside it
 * rather than a broken 3x2 with holes in it.
 *
 * ── EVERY TILE OPENS THE SAME VIEWER ──────────────────────────────────────
 *
 * `Lightbox` is a PORTAL, which is the whole reason this works inside the
 * mobile event deck: the deck's page track carries a `translate3d`, and
 * `position: fixed` resolves against the nearest transformed ancestor rather
 * than the viewport. Rendered in place, the viewer opened inside the page —
 * offset and clipped, which is the "images open awkwardly at the bottom" this
 * section was reported for.
 */

/** How many tiles the grid draws before it starts counting instead. */
const VISIBLE_TILES = 6;

/**
 * The span each position gets, by index.
 *
 * Written out rather than computed, because Tailwind only ships classes it can
 * see in the source — a template literal compiles to nothing. Position 0 is the
 * feature; everything after it is a unit tile.
 */
const TILE_SPAN = ['col-span-2 row-span-2', '', '', '', '', ''];

export function GalleryGrid({
  images,
  className,
}: {
  images: LightboxImage[];
  className?: string;
}) {
  const [openAt, setOpenAt] = React.useState<number | null>(null);

  // Absent, not empty. Most events have no gallery, and a heading over an empty
  // grid reads as photographs that failed to load.
  if (images.length === 0) return null;

  const tiles = images.slice(0, VISIBLE_TILES);
  const overflow = images.length - tiles.length;

  return (
    <>
      <div
        className={cn(
          // `auto-rows-[minmax(0,1fr)]` with a square-ish implicit row: the
          // feature tile is two rows tall, so the two beside it are each half
          // its height and the whole block keeps one shape on every event.
          'grid grid-cols-3 gap-2 [grid-auto-rows:minmax(0,5.25rem)] sm:[grid-auto-rows:minmax(0,7rem)]',
          className,
        )}
      >
        {tiles.map((image, index) => {
          const isLast = index === tiles.length - 1;
          const showsCount = isLast && overflow > 0;
          return (
            <button
              key={`${image.url}#${index}`}
              type="button"
              onClick={() => setOpenAt(index)}
              // The count tile opens at the first picture it is hiding, not at
              // itself — pressing "+4" to be shown the photograph you could
              // already see is the wrong answer to what it asks.
              aria-label={
                showsCount
                  ? `View all ${images.length} photos`
                  : image.kind === 'video'
                    ? `Play ${image.alt || 'the trailer'}`
                    : image.alt || `Photo ${index + 1}`
              }
              className={cn(
                'group/tile relative overflow-hidden rounded-xl bg-muted',
                'transition-transform duration-fast ease-out active:scale-[0.98]',
                'motion-reduce:transition-none motion-reduce:active:scale-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                TILE_SPAN[index] ?? '',
              )}
            >
              {/* Empty alt: the button already carries the description, and
                  repeating it announces every photograph twice. */}
              {image.kind === 'video' ? (
                /* ── A VIDEO TILE IS A STILL PLUS A BADGE ──────────────────
                   Never an `<iframe>` in the grid. Six embedded players in a
                   scroller is six third-party documents loading their own
                   scripts on the busiest public route, and each one swallows
                   the tap that was meant to open the viewer. The tile stays a
                   button; the player exists only full-screen.

                   `poster` is the still the caller supplies. There is no
                   automatic thumbnail — the provider's own thumbnail URL is
                   a different host with a different shape per provider, so a
                   missing one draws the gradient below rather than a guess
                   that 404s. */
                <>
                  {image.poster ? (
                    <Image
                      src={image.poster}
                      alt=""
                      fill
                      sizes={index === 0 ? '66vw' : '33vw'}
                      className="object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="absolute inset-0 bg-gradient-to-br from-primary/25 via-muted to-muted"
                    />
                  )}
                  {/* Dimmed, so a white play glyph reads over a bright still. */}
                  <span aria-hidden className="absolute inset-0 bg-black/25" />
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-1/2 top-1/2 inline-flex size-12 -translate-x-1/2 -translate-y-1/2',
                      'items-center justify-center rounded-full bg-white/90 text-ink-900 shadow-lg',
                      'transition-transform duration-fast group-hover/tile:scale-105',
                      'motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100',
                    )}
                  >
                    {/* `fill-current` — a play triangle reads as solid, and an
                        outlined one at 20px reads as a bug. */}
                    <Play className="size-5 translate-x-px fill-current" />
                  </span>
                </>
              ) : (
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes={index === 0 ? '66vw' : '33vw'}
                  className="object-cover"
                />
              )}
              {showsCount ? (
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center bg-black/55 text-h4 font-extrabold text-white backdrop-blur-sm"
                >
                  +{overflow}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {openAt !== null ? (
        <Lightbox
          images={images}
          index={openAt}
          onIndexChange={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      ) : null}
    </>
  );
}
