'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * A horizontal rail that PAGES instead of scrolling.
 *
 * There is no scroll container here at all: the track is moved with a
 * transform, so no scrollbar can appear under the cards. A scrollbar is browser
 * chrome dropped into a designed surface — and worse, a scrollable rail hides
 * how much more there is behind a gesture. Arrows plus a position readout say
 * it outright.
 *
 * How far to move is MEASURED, not assumed: the step is the first card's real
 * width plus the real gap, so the same component works for any card size at any
 * breakpoint without being told. The end stop is computed from how many cards
 * actually fit, so the last page is never a half-empty frame.
 *
 * Slides stay server-rendered — they come through `children` untouched.
 */
export function PagedRail({
  label,
  count,
  children,
  className,
}: {
  /** Accessible name, e.g. "Trending near you". */
  label: string;
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLUListElement>(null);
  const dragStart = React.useRef<number | null>(null);
  const [index, setIndex] = React.useState(0);
  const [metrics, setMetrics] = React.useState({ step: 0, perView: 1 });

  const measure = React.useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!viewport || !track || !first) return;
    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    const step = first.getBoundingClientRect().width + gap;
    const perView = Math.max(1, Math.round((viewport.clientWidth + gap) / step));
    setMetrics({ step, perView });
    setIndex((i) => Math.min(i, Math.max(0, count - perView)));
  }, [count]);

  React.useEffect(() => {
    measure();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measure]);

  const maxIndex = Math.max(0, count - metrics.perView);
  const atStart = index <= 0;
  const atEnd = index >= maxIndex;

  const step = (delta: number) =>
    setIndex((i) => Math.min(maxIndex, Math.max(0, i + delta * metrics.perView)));

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const delta = event.clientX - start;
    if (Math.abs(delta) < 48) return;
    step(delta < 0 ? 1 : -1);
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div ref={viewportRef} className="overflow-hidden">
        <ul
          ref={trackRef}
          onPointerDown={(event) => {
            dragStart.current = event.clientX;
          }}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragStart.current = null;
          }}
          className={cn(
            // 16px between slides on a phone, 24px from `sm`. The step is
            // MEASURED from the real computed `column-gap`, so changing this
            // needs no other edit — see `measure` above.
            'flex touch-pan-y gap-4 sm:gap-6',
            'transition-transform duration-carousel ease-spring motion-reduce:transition-none',
          )}
          style={{ transform: `translate3d(-${index * metrics.step}px, 0, 0)` }}
        >
          {children}
        </ul>
      </div>

      {maxIndex > 0 ? (
        <div className="flex items-center justify-between gap-4">
          {/* Position, stated rather than implied by a scrollbar's thumb. */}
          <p
            className="text-caption tabular-nums text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {`${Math.min(index + metrics.perView, count)} of ${count}`}
          </p>

          <div className="flex items-center gap-2" role="group" aria-label={`${label} controls`}>
            <RailButton
              onClick={() => step(-1)}
              disabled={atStart}
              label={`Show previous ${label}`}
              icon={<ChevronLeft className="size-4" aria-hidden />}
            />
            <RailButton
              onClick={() => step(1)}
              disabled={atEnd}
              label={`Show next ${label}`}
              icon={<ChevronRight className="size-4" aria-hidden />}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RailButton({
  onClick,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        // 44px, not 40. This is the ONLY way through the rail on a touch
        // device that isn't a swipe, so it has to clear the touch floor —
        // `--control-height` is that number, named so it cannot drift.
        'inline-flex size-control items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm',
        'transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-md active:scale-95',
        'disabled:pointer-events-none disabled:opacity-40',
        'motion-reduce:hover:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      {icon}
    </button>
  );
}
