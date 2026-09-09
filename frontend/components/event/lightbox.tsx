'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';

/**
 * A full-screen image viewer, and it is a PORTAL for a specific reason.
 *
 * ── THE BUG THIS FIXES ────────────────────────────────────────────────────
 *
 * The gallery's old lightbox was `fixed inset-0` rendered where it stood in the
 * tree. That is correct almost everywhere and completely wrong inside the
 * mobile event deck: `position: fixed` resolves against the nearest ancestor
 * with a `transform`, not against the viewport, and the deck's page track
 * carries a `translate3d` that moves with every horizontal swipe. So a tap on a
 * gallery photograph opened the viewer inside the page — offset, clipped by the
 * scroller, and reported as "images open awkwardly at the bottom".
 *
 * No amount of z-index fixes that. A portal to `document.body` does, because it
 * takes the element out of the transformed subtree entirely — which is the only
 * thing that restores `fixed`'s meaning.
 *
 * ── AND IT IS ACTUALLY FULL SCREEN ────────────────────────────────────────
 *
 * The old one was `max-w-4xl` inside `p-4` with the picture in a 16:9 box: a
 * windowed viewer that letterboxed a portrait poster twice over. This fills the
 * viewport and lets the image be its own shape inside it — `object-contain`,
 * because somebody who has asked to see a photograph properly wants all of it,
 * including the parts the page's fixed frame crops.
 *
 * ── NOT A RADIX DIALOG, DELIBERATELY ──────────────────────────────────────
 *
 * The same three behaviours — Escape, backdrop click, focus trap via the shared
 * helper — in a fraction of the code, and without modal mode's document-wide
 * style invalidation, which cost this app a second of INP everywhere it was
 * used. It mounts nothing until opened.
 */

export type LightboxImage = {
  url: string;
  /** The organiser's alt text. Doubles as the caption — it is the closest thing
   *  to one the API stores, and a sighted visitor benefits from it too. */
  alt: string;
};

export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<Element | null>(null);
  useBackgroundInert(true);

  /**
   * `document` does not exist on the server, and a portal cannot be rendered
   * before mount without a hydration mismatch. `mounted` is the standard guard;
   * the component renders null for exactly one commit.
   */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const count = images.length;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const current = images[safeIndex] ?? null;

  const step = React.useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndexChange((safeIndex + delta + count) % count);
    },
    [count, onIndexChange, safeIndex],
  );

  React.useEffect(() => {
    // Captured on mount, not read in the cleanup: by then focus may have moved
    // and the control that opened this would never get it back.
    openerRef.current = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, [onClose, step]);

  // Focus moves in once the panel exists, so a keyboard user is inside the trap
  // rather than still on the page behind it.
  React.useEffect(() => {
    if (mounted) panelRef.current?.focus({ preventScroll: true });
  }, [mounted]);

  /** A horizontal swipe steps the gallery — the gesture people arrive with. */
  const touchRef = React.useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) touchRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchRef.current;
    const touch = event.changedTouches[0];
    touchRef.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Decisively sideways, and far enough to be a swipe rather than a slip.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1);
  };

  if (!mounted || !current) return null;

  return createPortal(
    <div
      // `z-[100]` and not the `z-modal` token: this has to sit above the deck,
      // which IS `z-modal`, and above any sub-sheet it has opened.
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 animate-in fade-in-0"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={current.alt || 'Photo'}
        tabIndex={-1}
        onKeyDown={(event) => trapTab(event, panelRef.current)}
        // The picture is not a dismiss target: a tap meant to steady a pinch
        // should not close the thing being looked at. The backdrop is.
        onClick={(event) => event.stopPropagation()}
        className="relative flex h-full w-full flex-col outline-none"
      >
        {/* ── THE CLOSE CONTROL ─────────────────────────────────────────
            Top RIGHT and inside the safe area. An X in the corner is the one
            control every viewer has, and on a phone it is the only exit that
            does not require knowing about Escape or a backdrop. */}
        <div
          className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 px-4"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        >
          {count > 1 ? (
            <p aria-live="polite" className="text-caption tabular-nums text-white/80">
              {safeIndex + 1} of {count}
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo"
            className={cn(
              'inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur',
              'transition duration-fast hover:bg-white/20 active:scale-95',
              'motion-reduce:transition-none motion-reduce:active:scale-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
            )}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {/* The picture, at whatever shape it is, filling what is left. */}
        <div className="relative min-h-0 flex-1">
          <Image
            src={current.url}
            alt={current.alt}
            fill
            sizes="100vw"
            className="object-contain"
            priority
          />
          {count > 1 ? (
            <>
              <Arrow side="left" onClick={() => step(-1)} />
              <Arrow side="right" onClick={() => step(1)} />
            </>
          ) : null}
        </div>

        {current.alt ? (
          <p
            className="px-6 pt-3 text-center text-body-sm text-white/80"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          >
            {current.alt}
          </p>
        ) : (
          <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
        )}
      </div>
    </div>,
    document.body,
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
        'absolute top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full',
        'bg-white/10 text-white backdrop-blur transition duration-fast hover:bg-white/20 active:scale-95',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
