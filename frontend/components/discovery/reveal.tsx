'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Scroll reveal: fade + a 20px rise as a block enters the viewport.
 *
 * Three rules keep this from being decoration that costs something:
 *
 * 1. **Never above the fold.** An element starting at `opacity: 0` is not
 *    eligible to be the Largest Contentful Paint, so revealing the hero would
 *    trade a real metric for a flourish. Only below-fold sections use it.
 * 2. **One observer per block, disconnected after it fires.** Reveals are a
 *    one-shot: re-animating on every scroll-by is the "distracting effect" the
 *    brief rules out, and keeping observers alive costs main-thread work on a
 *    page the user is trying to scroll.
 * 3. **Reduced motion opts out entirely** — the CSS makes the content visible,
 *    and this component then has nothing to do.
 *
 * The transform is on the wrapper only, so nothing inside can be laid out
 * differently before and after: reveal never causes layout shift.
 */
export function Reveal({
  children,
  delayMs = 0,
  className,
}: {
  children: React.ReactNode;
  /** Stagger within a group. Keep it small — 60ms reads as one motion. */
  delayMs?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Already on screen at mount (a deep link, a short page): reveal without
    // waiting for a scroll that may never come.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-revealed', 'true');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('reveal', className)}
      style={delayMs ? ({ '--reveal-delay': `${delayMs}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
