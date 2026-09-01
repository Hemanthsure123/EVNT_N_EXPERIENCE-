'use client';

import * as React from 'react';
import { formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { AnimatedNumber } from './motion';

/**
 * The mobile action bar: what it costs, and the one thing to press.
 *
 * It is the ONE primary action on either checkout screen, at every width. It
 * used to be `lg:hidden` with a separate desktop button above the fold; two
 * live buttons doing the same thing on one screen is two places a double-tap
 * can fire from, which on a money path is not a cosmetic duplication.
 *
 * ── AND IT NO LONGER STACKS ON A BOTTOM NAV ───────────────────────────────
 *
 * The checkout left the site layout, so there is no tab bar underneath it any
 * more. What remains is the phone's own gesture inset, which the bar still pads
 * for itself — a Pay button under the home indicator is a button nobody can
 * press.
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
 */
export function StickyActionBar({
  total,
  caption,
  leading,
  children,
  className,
}: {
  total: number;
  caption: string;
  /**
   * Replaces the default amount-and-caption block on the left.
   *
   * The ticket screen wants the total there (it is the running figure somebody
   * is building up). The review screen does not: the total has already been
   * itemised twice above, and the left of that bar is where naming the payment
   * provider is worth more than repeating a number.
   */
  leading?: React.ReactNode;
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
        'pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center gap-4 sm:px-2">
        {leading ?? (
          <div className="flex min-w-0 flex-col">
            <AnimatedNumber
              value={total}
              format={(value) => formatFromPrice(value) ?? '—'}
              className="text-h4 text-foreground"
            />
            <span className="truncate text-caption text-muted-foreground">{caption}</span>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center">{children}</div>
      </div>
    </div>
  );
}
