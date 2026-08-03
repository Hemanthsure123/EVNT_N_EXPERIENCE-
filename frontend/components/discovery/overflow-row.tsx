'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * A single row that NEVER wraps and NEVER scrolls: whatever doesn't fit is
 * handed to `renderMore` instead.
 *
 * This is the "priority+" pattern, and it's here because the alternatives both
 * fail the brief. A horizontally scrolling strip hides filters behind a gesture
 * and puts a scrollbar in the sticky toolbar. Breakpoint rules (`hidden lg:flex`)
 * guess at content width, so they either clip early on a narrow laptop or
 * overflow on a long category label — the fit depends on the text, which no
 * breakpoint knows.
 *
 * How it stays cheap and stable:
 *
 * - Widths are measured ONCE, from a render where every item AND the "More"
 *   button are visible, and cached. Later resizes recompute the cut from the
 *   cache — never from the DOM, because by then the hidden items are
 *   `display: none` and would measure as zero, making the row oscillate. The
 *   "More" button has to be visible for that first pass too, or the space it
 *   needs is reserved as zero and the button itself ends up clipped.
 * - The cut is computed in a layout effect, so the trimmed row is what paints.
 *   Nothing flashes and nothing shifts; CLS is unaffected.
 * - `ResizeObserver` on the row itself, not `window` — the row also narrows when
 *   the result count beside it gets longer, which a window listener misses.
 * - Re-measurement is keyed on the item KEYS, not on the array identity. The
 *   caller rebuilds its item array on every filter change (the chips carry live
 *   pressed state), and re-reading twelve `offsetWidth`s forces a synchronous
 *   layout inside the interaction — 157ms of it at 4x CPU, measured. The
 *   widths can't have changed, so the signature says so and the effect skips.
 *
 * Server-rendered output has EVERY item visible. That's the correct no-JS
 * fallback: with the measurement never running, all the filters are reachable
 * (the row wraps rather than clipping, via `flex-wrap` under `no-js`), instead
 * of a "More" button that can't open.
 */

export type OverflowItem = {
  key: string;
  node: React.ReactNode;
};

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function OverflowRow({
  items,
  /** Rendered at the end of the row when anything is hidden. */
  renderMore,
  gapPx,
  className,
}: {
  items: OverflowItem[];
  renderMore: (hidden: OverflowItem[]) => React.ReactNode;
  /** Must match the row's CSS gap — measurement can't read `gap` per item. */
  gapPx: number;
  className?: string;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLDivElement>(null);
  /** Item widths from the all-visible render; index-aligned with `items`. */
  const widths = React.useRef<number[]>([]);
  const moreWidth = React.useRef(0);
  const [visibleCount, setVisibleCount] = React.useState(items.length);
  /** False until the first pass has read every width; see the note above. */
  const [measured, setMeasured] = React.useState(false);
  /** Changes only when the SET of items changes, not when their props do. */
  const signature = items.map((item) => item.key).join('|');

  const measure = React.useCallback(() => {
    const row = rowRef.current;
    if (!row) return;

    const available = row.clientWidth;
    const cached = widths.current;
    if (!cached.length) return;

    // Does everything fit with no "More" at all? Then no "More" is rendered,
    // and its width mustn't be reserved.
    const total = cached.reduce((sum, w) => sum + w, 0) + gapPx * (cached.length - 1);
    if (total <= available) {
      setVisibleCount(cached.length);
      return;
    }

    const reserved = moreWidth.current + gapPx;
    let used = 0;
    let count = 0;
    for (let i = 0; i < cached.length; i += 1) {
      const next = used + (i === 0 ? 0 : gapPx) + cached[i]!;
      if (next + reserved > available) break;
      used = next;
      count += 1;
    }
    setVisibleCount(count);
  }, [gapPx]);

  // Cache widths from the all-visible first render, then trim before paint.
  useIsomorphicLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const cells = Array.from(row.querySelectorAll<HTMLElement>('[data-overflow-cell]'));
    widths.current = cells.map((cell) => cell.offsetWidth);
    moreWidth.current = moreRef.current?.offsetWidth ?? 0;
    setMeasured(true);
    measure();
    // Re-measure only when the item SET changes — see the note above.
  }, [signature, measure]);

  React.useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  const hidden = items.slice(visibleCount);

  return (
    <div
      ref={rowRef}
      className={cn('flex min-w-0 flex-1 items-center overflow-hidden', className)}
      style={{ gap: `${gapPx}px` }}
    >
      {items.map((item, index) => (
        <div
          key={item.key}
          data-overflow-cell
          // `hidden` (display:none) rather than visibility/opacity: a filter
          // that's been moved into the More panel must not be tabbable in two
          // places at once.
          className={cn('shrink-0', index >= visibleCount && 'hidden')}
        >
          {item.node}
        </div>
      ))}
      <div ref={moreRef} className={cn('shrink-0', measured && !hidden.length && 'hidden')}>
        {renderMore(hidden)}
      </div>
    </div>
  );
}
