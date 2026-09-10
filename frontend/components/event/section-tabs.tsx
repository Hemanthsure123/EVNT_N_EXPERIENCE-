'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The event page's section tabs — About | Photos | Venue | Help.
 *
 * ── STICKY INSIDE A SCROLLER, NOT ON THE WINDOW ───────────────────────────
 *
 * `position: sticky; top: 0` sticks to the nearest SCROLLING ANCESTOR, which
 * here is the deck page's own scroller rather than the document. That is the
 * whole reason this works without a scroll listener: the browser pins it when
 * the bar reaches the top of that box and releases it when its section ends,
 * with no measuring, no resize handling and nothing to keep in sync.
 *
 * It also means the tabs cannot be `fixed`. A fixed bar would resolve against
 * the deck's transformed page track (the same trap the lightbox portal exists
 * for) and would sit in the wrong place the moment somebody swiped.
 *
 * ── A TAB WITH NOTHING BEHIND IT IS ABSENT, NOT DISABLED ──────────────────
 *
 * The caller passes only the sections this event actually has. An event with
 * no photographs has no Photos tab — not a greyed one — because a disabled tab
 * is a promise the page is refusing to keep, and this codebase's rule
 * everywhere else is that a section nothing backs is absent.
 *
 * With fewer than two tabs it renders nothing at all: a single tab is a label
 * pretending to be a control.
 *
 * ── THE ACTIVE TAB FOLLOWS THE SCROLL, AND THE SCROLL FOLLOWS THE TAB ─────
 *
 * An `IntersectionObserver` against the scroller marks whichever section is
 * nearest the top; pressing a tab smooth-scrolls to that section. Both
 * directions matter — a tab bar that only navigates loses its place the moment
 * somebody scrolls by hand, and one that only reports is not a control.
 */

export type SectionTab = {
  /** The `id` of the element to scroll to. */
  id: string;
  label: string;
};

export function SectionTabs({
  tabs,
  scrollerRef,
  className,
}: {
  tabs: SectionTab[];
  /** The element the sections scroll inside — the observer's root. */
  scrollerRef: React.RefObject<HTMLElement>;
  className?: string;
}) {
  const [active, setActive] = React.useState(tabs[0]?.id ?? '');
  const barRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = scrollerRef.current;
    if (!root || tabs.length < 2) return;

    const sections = tabs
      .map((tab) => root.querySelector(`#${CSS.escape(tab.id)}`))
      .filter((node): node is Element => node !== null);
    if (sections.length === 0) return;

    /**
     * `rootMargin` pulls the observed band up to a strip just under the bar.
     * Without it a tall section is "intersecting" for most of the page and the
     * active tab lags a whole section behind the reader.
     */
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { root, rootMargin: '-72px 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [scrollerRef, tabs]);

  /**
   * Keep the ACTIVE tab in view IN THE BAR — and only in the bar.
   *
   * ── THE BUG THIS IS THE FIX FOR ────────────────────────────────────────
   *
   * This was `current.scrollIntoView({ block: 'nearest', inline: 'nearest' })`,
   * and `scrollIntoView` does not scroll one element: it walks up and scrolls
   * EVERY scrollable ancestor until the target is visible in each of them. The
   * bar is `position: sticky` inside the page's scroller, so every time the
   * observer changed the active tab — which is every time you scroll past a
   * section — this asked the PAGE to reposition too, smoothly, upward.
   *
   * The symptom was exact: scrolling down reached "Who's taking the stage" and
   * the page pulled itself back up, over and over, so the bottom of the page
   * could not be reached at all. The tab bar was fighting the finger.
   *
   * `scrollTo` on the strip moves ONE element on ONE axis. There is no ancestor
   * involved and no vertical component, so the page is untouched.
   */
  React.useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const current = bar.querySelector(`[data-tab="${CSS.escape(active)}"]`);
    if (!(current instanceof HTMLElement)) return;
    // Nothing to do when the strip does not scroll, which is the common case:
    // four short tabs fit on every phone this ships to.
    if (bar.scrollWidth <= bar.clientWidth) return;
    const target = current.offsetLeft + current.clientWidth / 2 - bar.clientWidth / 2;
    bar.scrollTo({
      left: Math.max(0, Math.min(target, bar.scrollWidth - bar.clientWidth)),
      behavior: 'smooth',
    });
  }, [active]);

  if (tabs.length < 2) return null;

  const go = (id: string) => {
    const root = scrollerRef.current;
    const target = root?.querySelector(`#${CSS.escape(id)}`);
    if (!(target instanceof HTMLElement)) return;
    setActive(id);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    /* ── THE STICKY LANE ────────────────────────────────────────────────
       `-mx-4 px-4` so the lane's own background reaches the screen edges while
       the pill inside it lines up with the content's gutter — otherwise the
       sticky state shows the page sliding past in two four-pixel channels
       either side of it.

       `my-6` is the separation that was asked for, and it is on the LANE
       rather than on the pill: the pill is what sticks, and a margin on a
       sticky element is measured from where it started, so putting it there
       would leave the gap behind when it pinned. */
    <div className={cn('sticky top-0 z-50 -mx-4 my-6 bg-background px-4 py-2', className)}>
      <div
        ref={barRef}
        role="tablist"
        aria-label="Event sections"
        className={cn(
          // ── DARK IN BOTH THEMES, FROM THE `ink` RAMP ────────────────────
          //
          // Not `bg-neutral-800`: this codebase has exactly one way to say
          // "this surface is dark whatever the reader's theme is", and it is
          // the theme-INDEPENDENT `ink` ramp — the same one the issued ticket
          // and the pass card use, for the same reason. A semantic token would
          // swap places between themes and this control would invert with the
          // page; a raw Tailwind grey would be a fourth palette on a product
          // that has three.
          'flex items-center gap-1 rounded-full bg-ink-900 p-1',
          // Horizontally scrollable if a fifth tab ever appears, and
          // `touch-pan-x` so a vertical swipe over the bar scrolls the PAGE
          // rather than being arbitrated against the strip.
          'touch-pan-x overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab={tab.id}
              aria-selected={current}
              onClick={() => go(tab.id)}
              className={cn(
                // UNIFORM: every tab gets the same padding, the same radius and
                // the same weight, so the white pill is the only difference
                // between them and the row cannot look ragged.
                'flex-1 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-body-sm font-bold',
                'transition-colors duration-fast motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                current
                  ? 'bg-ink-25 text-ink-950'
                  : 'bg-transparent text-ink-300 hover:text-ink-50',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
