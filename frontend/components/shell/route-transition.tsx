'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

/**
 * Pending state for header navigations, and the bar that draws it.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 *
 * The App Router streams a route in; between the click and the first byte of
 * new markup, nothing on screen changes. On a warm, prefetched route that gap
 * is a frame. On a cold one it is long enough that people press the link
 * again. The header is the one piece of chrome present on every route, so it
 * is where that feedback belongs.
 *
 * ── IT REPORTS REAL PENDING STATE, NEVER A TIMER ──────────────────────────
 *
 * `useTransition` is the only thing in the App Router that actually knows: wrap
 * `router.push` in `startTransition` and `isPending` stays true until the new
 * route's payload has arrived. The alternative — start a fake bar on click and
 * stop it when `usePathname()` changes — cannot see a navigation that was
 * cancelled or that failed, so the bar sticks at 90% forever and the page looks
 * broken when it is merely idle. A progress indicator that can lie about
 * progress is worse than none.
 *
 * ── MODIFIED CLICKS ARE LEFT ALONE ────────────────────────────────────────
 *
 * Taking over a click means taking over ⌘-click, ctrl-click, shift-click and
 * middle-click too, unless they are explicitly handed back. Missing that makes
 * the header the one place on the site where "open in a new tab" silently does
 * nothing — and people do open nav links in new tabs.
 */

type RouteTransition = {
  /** True while a navigation started from this header is still resolving. */
  pending: boolean;
  /** Attach to a `next/link`'s onClick to route through the transition. */
  onNavigate: (event: React.MouseEvent<HTMLElement>, href: string) => void;
};

/** Outside a provider (the style guide's bare `Header`) links behave normally. */
const INERT: RouteTransition = { pending: false, onNavigate: () => {} };

const RouteTransitionContext = React.createContext<RouteTransition | null>(null);

export function useRouteTransition(): RouteTransition {
  return React.useContext(RouteTransitionContext) ?? INERT;
}

export function RouteTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const onNavigate = React.useCallback(
    (event: React.MouseEvent<HTMLElement>, href: string) => {
      // Anything that isn't a plain primary-button click belongs to the
      // browser — see the note above.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      startTransition(() => router.push(href));
    },
    [router],
  );

  const value = React.useMemo(() => ({ pending, onNavigate }), [pending, onNavigate]);

  return (
    <RouteTransitionContext.Provider value={value}>{children}</RouteTransitionContext.Provider>
  );
}

/**
 * The indeterminate bar along the header's bottom edge.
 *
 * It fills fast and then decelerates, never reaching the end on its own — the
 * shape of a load whose remaining time is unknown. Arriving at 100% and waiting
 * there would be the same lie as a fake timer.
 *
 * Transform only (`scaleX` off a left origin), so the animation is composited
 * and the header's own layout is never touched by it.
 *
 * It is ONE colour — the wayfinding violet — not the brand gradient it used to
 * be. A 2px violet→pink sweep on a white bar was the loudest two pixels in the
 * chrome, for the least important thing on screen. Violet rather than ink
 * because a near-black hairline against a near-black hairline border is not a
 * progress bar, it is a slightly thicker border.
 */
export function RouteProgress({ className }: { className?: string }) {
  const { pending } = useRouteTransition();
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'done'>('idle');
  // Read inside the effect without making it a dependency: the effect must run
  // when `pending` flips and at no other time, or clearing its own timeout
  // becomes a race against itself.
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;

  React.useEffect(() => {
    if (pending) {
      // A prefetched route resolves in a frame or two. A bar that appears and
      // vanishes inside 100ms reads as a glitch, so nothing is drawn until the
      // navigation has taken long enough to be worth reporting.
      const show = window.setTimeout(() => setPhase('loading'), 140);
      return () => window.clearTimeout(show);
    }
    if (phaseRef.current === 'idle') return undefined;
    setPhase('done');
    const clear = window.setTimeout(() => setPhase('idle'), 280);
    return () => window.clearTimeout(clear);
  }, [pending]);

  return (
    <>
      {/* Announced, not just drawn: the bar is the only signal that a press
          registered, and it is invisible to a screen reader. */}
      <span role="status" aria-live="polite" className="sr-only">
        {phase === 'loading' ? 'Loading page' : ''}
      </span>
      {phase === 'idle' ? null : (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden',
            className,
          )}
        >
          <span
            className={cn(
              'block h-full w-full origin-left bg-primary',
              phase === 'loading'
                ? 'animate-route-progress'
                : 'scale-x-100 opacity-0 transition-opacity duration-base ease-out',
            )}
          />
        </span>
      )}
    </>
  );
}
