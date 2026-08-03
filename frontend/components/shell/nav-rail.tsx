'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { useRouteTransition } from './route-transition';

/**
 * The header's primary nav: text items with ONE pill that slides between them.
 *
 * ── WHY A SLIDING PILL AND NOT A PILL PER ITEM ────────────────────────────
 *
 * A background that swaps instantly tells you where you ARE. One that travels
 * tells you where you CAME FROM, which is the question a person actually has
 * a quarter-second after pressing something. It is also the only motion in
 * this header that is not decoration: it is the state change, drawn.
 *
 * ── NO FRAMER MOTION HERE, DELIBERATELY ───────────────────────────────────
 *
 * `layoutId` is the obvious way to write this and is the wrong one. Framer is
 * confined to the booking funnel (see components/booking/motion.tsx) precisely
 * so ~35KB does not land on the discovery routes, and this component sits in
 * the site layout — it would ship on the homepage, which is the page whose LCP
 * matters most. Measuring two boxes and transitioning a transform is a dozen
 * lines and no bytes.
 *
 * ── THE ITEM MARKS ITSELF, THE RAIL FINDS IT ──────────────────────────────
 *
 * The rail locates the active child by `[data-nav-active]` rather than being
 * handed an index, so a child can be anything — a `Link`, a menu trigger — and
 * the rail never needs to know the shape of what it contains.
 *
 * ── BEFORE HYDRATION THE ACTIVE ITEM WEARS THE PILL ITSELF ────────────────
 *
 * Measurement needs a DOM, so the server cannot place the pill. Rather than
 * ship a nav with no visible current page until JS lands, the active item
 * carries the identical background as a plain class, and drops it in the same
 * layout effect that positions the real pill — before paint, so the handover
 * is never a frame of either both or neither.
 *
 * The colour is written TWICE for that reason — once on the sliding span and
 * once on the stand-in in `navItemClass` — and the two must always move
 * together, or every page load shows one frame of the wrong colour.
 *
 * ── THE PILL IS BUTTER, NOT THE BRAND VIOLET ──────────────────────────────
 *
 * It was `bg-secondary`, which was violet-100 with violet-700 text: the
 * saturated brand tint, on the one control whose whole job is to say "you are
 * here" rather than "press me". `--nav-active` is a warm butter/cream with
 * near-black ink (a deep warm brown with cream ink in dark) — quiet enough to
 * sit under a headline, dark enough on its label to clear AA at 15.18:1.
 *
 * It is its OWN token rather than a re-tint of `--secondary`, which ~80 call
 * sites across the app use for something else entirely.
 */

type PillBox = { left: number; width: number };

/** True once the sliding pill has been measured and placed. */
const NavRailContext = React.createContext(false);

export function NavRail({
  activeKey,
  children,
  className,
  label = 'Primary',
}: {
  /**
   * Changes whenever the active item might have — the pathname, in practice.
   * Re-measuring is driven by this rather than by the children, which are a
   * new array on every render and would re-measure on every render with it.
   */
  activeKey: string;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [pill, setPill] = React.useState<PillBox | null>(null);
  const [placed, setPlaced] = React.useState(false);
  const [armed, setArmed] = React.useState(false);

  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const active = root.querySelector<HTMLElement>('[data-nav-active="true"]');
      const box = active?.getBoundingClientRect();
      // An item hidden at this breakpoint measures zero. The pill must not
      // travel to something nobody can see — it hides instead.
      if (!box || box.width === 0) {
        setPill(null);
        setPlaced(false);
        return;
      }
      const origin = root.getBoundingClientRect();
      setPill({ left: box.left - origin.left, width: box.width });
      setPlaced(true);
    };

    measure();

    // The rail is content-sized, so anything that changes an item's width —
    // a breakpoint hiding one, a webfont replacing the fallback — changes the
    // rail's own width and lands here.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    // Belt and braces for the font swap: if the fallback and the real face
    // happen to measure the same total, the observer never fires.
    document.fonts?.ready.then(measure).catch(() => {});

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [activeKey]);

  // Transitions are armed one frame AFTER the first placement, so the pill
  // does not slide in from the left edge on arrival. Motion here explains a
  // navigation; on first paint there has not been one.
  React.useEffect(() => {
    if (!placed || armed) return undefined;
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, [placed, armed]);

  return (
    <nav ref={ref} aria-label={label} className={cn('relative items-center gap-1', className)}>
      <span
        aria-hidden
        className={cn(
          // No horizontal inset, deliberately: `pill.x === item.x` to the
          // rounded pixel is asserted by e2e, and an inset would break it.
          'pointer-events-none absolute inset-y-0 left-0 rounded-full bg-nav-active',
          pill ? 'opacity-100' : 'opacity-0',
          armed &&
            'transition-[transform,width,opacity] duration-base ease-spring motion-reduce:transition-none',
        )}
        style={pill ? { width: pill.width, transform: `translateX(${pill.left}px)` } : undefined}
      />
      <NavRailContext.Provider value={placed}>{children}</NavRailContext.Provider>
    </nav>
  );
}

/**
 * The one class list every rail item wears, so a `Link` and a menu trigger are
 * the same control with different behaviour rather than two lookalikes that
 * drift.
 *
 * `whitespace-nowrap` + `shrink-0` are load-bearing, not tidiness: without
 * them a flex item shrinks below its text and "Hire a band" stacks into three
 * lines the moment the row gets tight — which is exactly how this header used
 * to break at 1024px.
 */
export function navItemClass(active: boolean, placed: boolean, className?: string) {
  return cn(
    'relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-2',
    'text-body-sm font-medium transition-[color,background-color,transform] duration-fast ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'active:scale-95 motion-reduce:active:scale-100',
    active
      ? // The background is the sliding pill's job once it exists; this is the
        // pre-hydration stand-in described above. Both literals are
        // `nav-active` — change one and you must change the other.
        cn('text-nav-active-foreground', !placed && 'bg-nav-active')
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    className,
  );
}

/** Read inside the rail by items that render their own trigger (the menu). */
export function useNavItemClass() {
  const placed = React.useContext(NavRailContext);
  return React.useCallback(
    (active: boolean, className?: string) => navItemClass(active, placed, className),
    [placed],
  );
}

export function NavLink({
  href,
  active,
  children,
  className,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const applyClass = useNavItemClass();
  const { onNavigate } = useRouteTransition();
  return (
    <Link
      href={href}
      data-nav-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => onNavigate(event, href)}
      className={applyClass(active, className)}
    >
      {children}
    </Link>
  );
}
