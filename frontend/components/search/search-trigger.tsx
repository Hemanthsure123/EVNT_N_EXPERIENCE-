'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import { POPULAR_SEARCHES, type PopularSearch } from '@/lib/search/popular-searches';
import { cn } from '@/lib/utils/cn';
import { RollingHint, useRollingTerm } from './rolling-placeholder';
import { useSearchOverlay } from './search-context';

/**
 * Triggers for the deep-search overlay. All of them warm the overlay's chunk on
 * hover/focus, so the palette is already downloaded by the time it's opened.
 *
 * ── THE MAGNIFIER IS THE ONE VIOLET IN THE HEADER ─────────────────────────
 *
 * The light-first language spends the brand accent on WAYFINDING only — the
 * search glyph, a date on an event page, a selected hairline — and never on a
 * button fill. So the leading magnifier in the header field and in the hero bar
 * is `text-primary` at rest rather than a grey that only becomes violet on
 * hover, which is a colour nobody using a touch screen ever saw.
 *
 * Hover states moved OFF the accent for the same reason: `hover:border-primary`
 * on a field turns its edge into a brand hairline for no reason a reader can
 * name. They are neutral now (`border-border-strong`).
 */

/** The sentence used when there is nothing to roll, and as the spoken label. */
const DEFAULT_HINT = 'Search events, artists, venues or cities';

/**
 * Every trigger passes ITSELF as the anchor, so the panel opens attached to
 * the control that was pressed rather than jumping to the middle of the
 * screen. The keyboard shortcuts (⌘K, /) pass nothing and get the centred
 * palette — see the note in search-context.tsx.
 */
function useTriggerProps() {
  const { openSearch, preload } = useSearchOverlay();
  return {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => openSearch('', event.currentTarget),
    onPointerEnter: preload,
    onFocus: preload,
  };
}

/**
 * The header's search affordance — looks like a field, behaves like a button.
 *
 * It is fluid, not fixed: the header's centre column hands it whatever the
 * brand, nav and actions leave behind, which is ~425px at xl and ~240px at lg.
 * A fixed width here is what made the old header overlap its own nav, so the
 * two things that would need one — the placeholder and the shortcut hint —
 * shorten and disappear on the way down instead of forcing the row wider.
 *
 * ── AND ITS LABEL DOES NOT ROLL ───────────────────────────────────────────
 *
 * The rolling hint is on the hero bar only. This control is persistent chrome:
 * it is on the checkout review step, the ticket wallet and the organiser
 * dashboard, where a permanently moving word in the corner of the eye is
 * motion nobody chose and cannot leave. The hero is a place somebody is
 * deciding what to do, which is the only place a suggestion is worth the
 * movement.
 */
export function HeaderSearchTrigger({ className }: { className?: string }) {
  const props = useTriggerProps();
  return (
    <button
      type="button"
      {...props}
      className={cn(
        // `h-control` is the 44px touch-target floor, named so it cannot drift.
        'group flex h-control w-full items-center gap-2.5 rounded-full border border-input bg-surface px-4 text-body-sm text-muted-foreground shadow-sm transition duration-fast ease-out',
        'hover:border-border-strong hover:text-foreground hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-primary" aria-hidden />
      {/* Two labels, one visible at a time: at lg the column is too narrow for
          the long one, and a placeholder truncated mid-word ("Search events,
          arti…") reads as a broken field rather than a short one. */}
      <span className="flex-1 truncate text-left xl:hidden">Search events, artists…</span>
      <span className="hidden flex-1 truncate text-left xl:inline">
        Search events, artists, venues or cities…
      </span>
      {/* A shortcut nobody can see is a shortcut nobody uses — but it is the
          first thing to go when the field is short, because it costs width the
          placeholder needs more. */}
      <kbd
        className="hidden size-6 shrink-0 items-center justify-center rounded-md border border-border bg-sunken font-sans text-caption text-muted-foreground xl:inline-flex"
        aria-hidden
      >
        /
      </kbd>
    </button>
  );
}

/**
 * Compact icon trigger for narrow viewports — below `lg`, where the field does
 * not fit the width budget.
 *
 * Its glyph stays INK rather than joining the violet magnifiers above. This is
 * one of four icon buttons in the header's action row; tinting exactly one of
 * them reads as an emphasis nobody meant, where the same violet inside a field
 * reads as part of the field.
 */
export function CompactSearchTrigger({ className }: { className?: string }) {
  const { openSearch, preload } = useSearchOverlay();
  // Deliberately NOT anchored. This is a 44px icon button on a narrow viewport;
  // a panel hung beneath it would be pinned to one corner with nothing to align
  // to. The centred palette is the right shape at this size.
  const props = {
    onClick: () => openSearch(),
    onPointerEnter: preload,
    onFocus: preload,
  };
  return (
    <button
      type="button"
      aria-label="Search events"
      {...props}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-fast ease-out hover:bg-muted',
        'active:scale-95 motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Search className="size-5" aria-hidden />
    </button>
  );
}

/**
 * The hero's headline search bar — the page's primary call to action.
 *
 * ── IT IS TWO CONTROLS NOW, AND THAT IS THE WHOLE POINT ───────────────────
 *
 * The trending searches moved into this bar, so the hint text is no longer
 * decoration: it names a real query. A suggestion you cannot act on in one
 * press is a suggestion nobody acts on, so the bar was split.
 *
 *   the field  — opens the palette, exactly as before. Pressing the primary
 *                control of the page must never teleport somebody to results
 *                for a phrase they did not choose, so this half is unchanged
 *                and the rolling term travels WITH it: the palette freezes on
 *                the same suggestion and Enter on the empty box runs it.
 *   the pill   — runs the suggestion showing right now. A real `<a>`, because
 *                it goes to a page; its accessible name says which phrase, so
 *                nothing about it depends on having watched the animation.
 *
 * Below `sm` the pill collapses to a 44px circle rather than disappearing (it
 * used to be `hidden sm:inline-flex`). On a phone the trailing label is what
 * there is no room for; the ACTION is not, and dropping it would leave the
 * hint decorative on the majority of sessions.
 *
 * ── THE PILL IS BLACK, NOT A GRADIENT ─────────────────────────────────────
 *
 * `--cta` fill with `--cta-foreground` on it, `px-pill-lg` of horizontal room
 * because a pill's corners eat the ends of its label. It inverts to a
 * near-white pill with near-black text in dark, which is the whole point of
 * `--cta` being its own token: the same class list is correct in both themes.
 */
export function HeroSearchTrigger({
  className,
  terms,
  placeholder,
}: {
  className?: string;
  /**
   * Operator-curated suggestions (`cms.PopularSearch`). Falls back to the
   * bundled list, which is what the panel falls back to as well — one list, so
   * the bar and the panel never suggest two different things.
   */
  terms?: PopularSearch[];
  /** The CMS's `hero.search_placeholder`, used as the spoken/idle sentence. */
  placeholder?: string;
}) {
  const { openSearch, preload } = useSearchOverlay();
  /**
   * Hovering or focusing the bar stops the roll.
   *
   * Somebody who has reached for this control is about to read the suggestion
   * or press past it, and either way a word that changes under the cursor is a
   * moving target. It resumes on the way out.
   */
  const [engaged, setEngaged] = React.useState(false);
  // The panel hangs beneath the WHOLE bar, not beneath the half that was
  // pressed — anchoring to the field alone would leave it short of the pill.
  const barRef = React.useRef<HTMLDivElement>(null);

  const list = terms?.length ? terms : POPULAR_SEARCHES;
  const { index, item } = useRollingTerm(list, !engaged);
  const labels = React.useMemo(() => list.map((entry) => entry.label), [list]);
  const idle = placeholder?.trim() || DEFAULT_HINT;

  return (
    <div
      ref={barRef}
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocusCapture={() => setEngaged(true)}
      onBlurCapture={() => setEngaged(false)}
      className={cn(
        'group relative flex h-14 w-full items-center rounded-full border border-border bg-surface pl-1.5 pr-1.5 shadow-md transition duration-base ease-out',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
        'motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => openSearch('', barRef.current)}
        onPointerEnter={preload}
        onFocus={preload}
        // The stable sentence, never the animated one. The moving text is
        // `aria-hidden`; an accessible name that changes every three seconds
        // cannot be read out or acted on.
        aria-label={idle}
        className={cn(
          'flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full pl-3.5 pr-2 text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <Search className="size-5 shrink-0 text-primary" aria-hidden />
        <RollingHint
          terms={labels}
          index={index}
          fallback={idle}
          className="min-w-0 flex-1 text-body text-muted-foreground"
        />
      </button>

      {item ? (
        <Link
          href={item.href}
          aria-label={`Search for ${item.label}`}
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cta text-label text-cta-foreground transition-colors duration-fast ease-out',
            'hover:bg-cta-hover active:bg-cta-active',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'sm:w-auto sm:px-pill-lg',
          )}
        >
          <ArrowRight className="size-5 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">Search</span>
        </Link>
      ) : null}
    </div>
  );
}
