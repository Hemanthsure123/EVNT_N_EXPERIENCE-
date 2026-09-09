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

  // Keep the ACTIVE tab in view in the bar itself. With four short tabs this
  // never fires; with an event that grows a fifth on a narrow phone it is the
  // difference between a tab bar and a tab bar with a hidden current item.
  React.useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const current = bar.querySelector(`[data-tab="${CSS.escape(active)}"]`);
    if (current instanceof HTMLElement) {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
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
    <div
      // `-mx-4 px-4` so the bar's background reaches the screen edges while its
      // first pill lines up with the content's gutter — otherwise the sticky
      // state shows the page sliding past in two four-pixel channels.
      className={cn(
        'sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur',
        className,
      )}
    >
      <div
        ref={barRef}
        role="tablist"
        aria-label="Event sections"
        // Horizontally scrollable, and `touch-pan-x` so a vertical swipe over
        // the bar scrolls the PAGE rather than being arbitrated against it.
        className="flex touch-pan-x gap-2 overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                'shrink-0 rounded-full px-4 py-2 text-body-sm font-bold transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                current
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
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
