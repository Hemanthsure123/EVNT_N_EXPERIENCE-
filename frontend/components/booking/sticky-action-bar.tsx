'use client';

import * as React from 'react';
import { formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { AnimatedNumber } from './motion';

/**
 * The mobile action bar: what it costs, and the one thing to press.
 *
 * It sits above the site's bottom nav rather than over it, and it is the ONLY
 * primary action rendered below `lg` — the desktop button is hidden at those
 * widths. Two live "Continue" buttons on one screen is the duplicated-CTA
 * problem the brief calls out, and on a checkout it also means two places a
 * double-tap can fire from.
 *
 * ── IT IS GLASS BECAUSE IT IS GENUINELY FLOATING ──────────────────────────
 *
 * `.glass` is reserved for chrome that content scrolls underneath, which is
 * exactly this. It was hand-rolled here as `bg-background/95 backdrop-blur-md`,
 * a near-white bar over a near-white page separated by nothing but a hairline;
 * the shared recipe pairs the frost with `--glass-hairline`, which is what
 * actually draws the bar's edge on a white canvas, and `shadow-lg` gives it the
 * lift that says it is above the page rather than part of it.
 *
 * ── THE 768–1023px GAP, FIXED ─────────────────────────────────────────────
 *
 * Every caller renders this `lg:hidden`, so it is on screen from 0 to 1023px.
 * It was pinned at `bottom-16` to clear the site's bottom nav — but that nav is
 * `md:hidden`, so from 768px up the bar floated 64px above an empty strip of
 * page. The offset is now the nav's own height token, dropped to flush at `md`
 * where the nav stops existing: `bottom-bottom-nav md:bottom-0`. Changing the
 * nav's height now moves this with it instead of desynchronising it.
 */
export function StickyActionBar({
  total,
  caption,
  children,
  className,
}: {
  total: number;
  caption: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // ── THE BAR PUBLISHES ITS HEIGHT ──────────────────────────────────────
  //
  // Two independently-positioned fixed elements at the bottom of a phone
  // screen will collide, and this one collided with the cookie notice: the
  // notice sits at `bottom-16` with a higher stacking order, so on the ticket
  // step it landed exactly on "Continue" and swallowed every press. A visitor
  // who had not yet answered the cookie question could not check out at all,
  // and nothing on screen explained why the button did nothing.
  //
  // Rather than fight it with z-index — which would just hide the notice
  // behind the bar — the bar measures itself onto the document root, and
  // anything else pinned to the bottom edge stacks above it. One variable, set
  // by the element that knows the answer.
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--sticky-action-height', `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--sticky-action-height');
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        // ── THE BAR OWNS ITS OWN INSET ──────────────────────────────────
        // It sat at `bottom-bottom-nav`, which is the nav's HEIGHT and nothing
        // else — so on a phone with a gesture bar the whole control sat inside
        // the system's 34px, and "Pay" was under the home indicator. Sitting on
        // another element's height is also fragile in the other direction: the
        // moment the nav hides on scroll, a bar positioned against it is
        // floating above nothing.
        //
        // `bottom-0` plus its own padding puts it on the screen's real edge and
        // lifts its CONTENT clear of both the nav and the inset — one element
        // responsible for its own clearance.
        'glass fixed inset-x-0 bottom-0 z-sticky border-t px-4 pt-3 shadow-lg',
        'pb-[calc(var(--bottom-nav-height)_+_0.75rem_+_env(safe-area-inset-bottom))]',
        'md:pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-container items-center gap-4">
        <div className="flex min-w-0 flex-col">
          <AnimatedNumber
            value={total}
            format={(value) => formatFromPrice(value) ?? '—'}
            className="text-h4 text-foreground"
          />
          <span className="truncate text-caption text-muted-foreground">{caption}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center">{children}</div>
      </div>
    </div>
  );
}
