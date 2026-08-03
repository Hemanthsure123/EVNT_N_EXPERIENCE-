'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import type { PerformerPhoto } from '@/lib/api/performers';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';
import { cn } from '@/lib/utils/cn';

/**
 * A performer's photos.
 *
 * The same shape as the event page's hero gallery and for the same reasons —
 * a filmstrip only from the second image, `position: relative` framing so the
 * height is known before the bytes arrive, and a hand-rolled lightbox rather
 * than a modal dialog whose document-wide style invalidation costs this app a
 * second of INP.
 *
 * Plain `<img>` rather than `next/image`: the URLs come from a configurable
 * storage adapter, which is not a host that can be declared at build time.
 */
export function PhotoGallery({ photos, name }: { photos: PerformerPhoto[]; name: string }) {
  const [index, setIndex] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  useBackgroundInert(open);

  // Clamped rather than trusted: the list can shrink between renders, and an
  // out-of-range index renders nothing where the photograph should be.
  const safeIndex = Math.min(index, Math.max(photos.length - 1, 0));
  const current = photos[safeIndex] ?? null;

  const step = React.useCallback(
    (delta: number) =>
      setIndex((previous) => (previous + delta + photos.length) % Math.max(photos.length, 1)),
    [photos.length],
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const opener = openerRef.current;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus({ preventScroll: true });
    };
  }, [open, step]);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-feature w-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted">
        <p className="text-body-sm text-muted-foreground">No photos yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="relative aspect-feature w-full overflow-hidden rounded-2xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img
            src={current?.url}
            alt={current?.alt_text || name}
            className="size-full object-cover"
          />
          <button
            ref={openerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label={
              photos.length > 1 ? `View all ${photos.length} photos` : 'View photo full size'
            }
            className={cn(
              // `min-h-control`: this sat at 32px, over a photograph, on a
              // phone — the one control on the frame and the hardest to hit.
              'glass-media absolute bottom-3 right-3 inline-flex min-h-control items-center gap-2 rounded-full border px-3.5 py-2 text-label text-on-gradient shadow-sm sm:bottom-4 sm:right-4',
              'transition duration-fast ease-out hover:scale-105 active:scale-95',
              'motion-reduce:transition-none motion-reduce:hover:scale-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Expand className="size-4" aria-hidden />
            {photos.length > 1 ? `${photos.length} photos` : 'View photo'}
          </button>
        </div>

        {photos.length > 1 ? (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((photo, position) => (
              <li key={photo.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={photo.alt_text || `Photo ${position + 1}`}
                  aria-current={position === safeIndex}
                  className={cn(
                    'relative block size-16 overflow-hidden rounded-lg border transition-opacity sm:size-20',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    position === safeIndex
                      ? 'border-primary'
                      : 'border-border opacity-70 hover:opacity-100',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img src={photo.url} alt="" className="size-full object-cover" />
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
            aria-label={current.alt_text || name}
            tabIndex={-1}
            onKeyDown={(event) => trapTab(event, panelRef.current)}
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-full w-full max-w-4xl flex-col gap-3 outline-none"
          >
            <div className="relative aspect-feature w-full overflow-hidden rounded-2xl bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img
                src={current.url}
                alt={current.alt_text || name}
                className="size-full object-contain"
              />
              {photos.length > 1 ? (
                <>
                  <Arrow side="left" onClick={() => step(-1)} />
                  <Arrow side="right" onClick={() => step(1)} />
                </>
              ) : null}
            </div>

            <div className="flex flex-col items-center gap-2">
              {current.caption || current.alt_text ? (
                <p className="max-w-2xl text-center text-body-sm text-on-gradient">
                  {current.caption || current.alt_text}
                </p>
              ) : null}
              {photos.length > 1 ? (
                <p aria-live="polite" className="text-caption tabular-nums text-on-gradient">
                  {safeIndex + 1} of {photos.length}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="glass-media inline-flex min-h-control w-fit items-center gap-2 rounded-full border px-4 py-2 text-label text-on-gradient focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

function Arrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={cn(
        // 44px, not 40 — a lightbox is stepped through by thumb.
        'glass-media absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border text-on-gradient',
        'transition duration-fast hover:scale-105 active:scale-95',
        'motion-reduce:transition-none motion-reduce:hover:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
