'use client';

import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DatePicker } from './date-picker';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { CATEGORIES } from '@/lib/discovery/categories';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import type { DateWindowId } from '@/lib/discovery/date-windows';
import { type Facet, TIME_BANDS, type TimeBandId } from '@/lib/discovery/facets';
import {
  type DiscoveryFilters,
  EMPTY_FILTERS,
  SORT_OPTIONS,
  type PriceBandId,
  type SortId,
  activeFilterChips,
} from '@/lib/discovery/filters';
import { trapTab, useBackgroundInert } from '@/lib/utils/focus-trap';
import { cn } from '@/lib/utils/cn';

/**
 * The full filter set, as a slide-over.
 *
 * It replaces a permanent sidebar on purpose: a sidebar spends ~280px of every
 * viewport, forever, on controls that are used once at the start of a session
 * and then not again. Handing that column back to the grid is worth roughly one
 * extra card per row — which is the page's actual job.
 *
 * Bottom sheet on phones, left slide-over from `lg` (one `side="responsive"`
 * drawer, so the contents are written once).
 *
 * DRAFT-THEN-APPLY, not live-apply. Live filtering is right for the toolbar's
 * one-tap chips, where the result is visible behind your finger. It's wrong
 * here: the panel covers the grid, so every tap would refetch results nobody
 * can see. Draft state also makes Reset meaningful — it undoes the whole
 * session's worth of narrowing in one press, without a refetch per undone
 * filter. Closing without applying discards, which is what Cancel means
 * everywhere else.
 *
 * `modal={false}`, with the focus trap and background aria-hiding put back by
 * hand (lib/utils/focus-trap.ts explains the whole trade). Radix's modal mode
 * cost **1080ms** of processing to open this panel at 4x CPU throttling —
 * measured, not guessed — because it invalidates style and layout for the whole
 * document. Without it, the same interaction is ~300ms.
 *
 * The sections also render in TWO passes. Date, time and price paint
 * immediately; category, city, organiser and sort — around thirty more chips —
 * arrive on the next frame. They're below the fold of a panel that always opens
 * scrolled to the top, so nobody sees the difference, and it takes the open
 * interaction under the INP budget instead of just near it.
 *
 * WHAT'S NOT HERE, and why: distance, language, rating, accessibility and
 * duration have no backing field on the platform (no venue geocoding, no review
 * system, no `ends_at` on the card payload). Rendering them as controls that
 * quietly match everything would be a lie the user only discovers after
 * trusting it. Each is in BACKLOG.md with the field it needs.
 */

const WHEN_OPTIONS: { id: DateWindowId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

const PRICE_OPTIONS: { id: PriceBandId; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'under-500', label: 'Under ₹500' },
];

export function FilterDrawer({
  open,
  onOpenChange,
  filters,
  onApply,
  /** Organisers present in the loaded results, busiest first. */
  organisers,
  /** Time bands present in the loaded results. */
  timeBands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DiscoveryFilters;
  onApply: (next: DiscoveryFilters) => void;
  organisers: Facet[];
  timeBands: { id: TimeBandId; count: number }[];
}) {
  const [draft, setDraft] = React.useState(filters);
  /** Second-pass gate for the long sections — see the note above. */
  const [showRest, setShowRest] = React.useState(false);
  /** Which section the PHONE layout is showing. Ignored from `sm` up,
   *  where every section is on screen at once. */
  const [paneId, setPaneId] = React.useState('sort');
  const panelRef = React.useRef<HTMLDivElement>(null);
  useBackgroundInert(open);

  // Re-seed each time it opens: a chip toggled in the toolbar while the drawer
  // was shut must be reflected, and a discarded draft must not come back.
  React.useEffect(() => {
    if (open) {
      setDraft(filters);
      // Back to the first section on every open. Reopening onto whichever
      // pane was last used looks like the panel remembered a choice that
      // was never made.
      setPaneId('sort');
    }
  }, [open, filters]);

  React.useEffect(() => {
    if (!open) {
      setShowRest(false);
      return;
    }
    const frame = requestAnimationFrame(() => setShowRest(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const toggle = <K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) =>
    setDraft((current) => ({ ...current, [key]: current[key] === value ? null : value }));

  const changed = JSON.stringify(draft) !== JSON.stringify(filters);
  const count = activeFilterChips(draft).length + (draft.sort === 'soonest' ? 0 : 1);

  // -- SECTIONS AS DATA, RENDERED TWO WAYS ---------------------------------
  //
  // A phone shows ONE section at a time behind a left-hand list; a desktop
  // panel shows them all stacked, exactly as before. Both read this array, so
  // there is no second copy of the category chips to drift -- which is the only
  // way a two-layout panel stays honest as options are added.
  //
  // What is NOT here is as deliberate as what is. There is no "Genre": genres
  // are a `Performer` field on the hire marketplace and have nothing to do with
  // events, so a Genre pane would be a control filtering on a column events do
  // not have. And Sort offers three options because `lib/discovery/filters.ts`
  // defines three -- "Popularity" needs a view or booking count nobody stores,
  // and "Distance" needs coordinates most events do not carry. Either would
  // have to quietly match everything, which is the kind of control a visitor
  // only discovers is fake after trusting it.
  const sections: {
    id: string;
    title: string;
    hint?: string;
    activeCount: number;
    content: React.ReactNode;
  }[] = [
    {
      id: 'sort',
      title: 'Sort by',
      activeCount: draft.sort === 'soonest' ? 0 : 1,
      content: SORT_OPTIONS.map((option) => (
        <Chip
          key={option.id}
          selected={draft.sort === option.id}
          onClick={() => setDraft((current) => ({ ...current, sort: option.id as SortId }))}
          className="h-control px-pill"
        >
          {option.label}
        </Chip>
      )),
    },
    {
      id: 'date',
      title: 'Date',
      hint: 'When you want to go',
      activeCount: (draft.when ? 1 : 0) + (draft.dateFrom ? 1 : 0),
      content: (
        <>
          {WHEN_OPTIONS.map((option) => (
            <Chip
              key={option.id}
              selected={draft.when === option.id}
              onClick={() => toggle('when', option.id)}
              className="h-control px-pill"
            >
              {option.label}
            </Chip>
          ))}
          {/* The same control as the toolbar, so a range can be chosen from
              either surface and neither is the "real" one. Picking explicit
              dates clears the named window -- the two would otherwise
              contradict each other in the URL. */}
          <DatePicker
            from={draft.dateFrom}
            to={draft.dateTo}
            onApply={({ from, to }) =>
              setDraft((current) => ({
                ...current,
                when: from ? null : current.when,
                dateFrom: from,
                dateTo: to,
              }))
            }
            className="h-control px-pill"
          />
        </>
      ),
    },
    ...(timeBands.length
      ? [
          {
            id: 'time',
            title: 'Time of day',
            hint: 'Start time, IST',
            activeCount: draft.time ? 1 : 0,
            content: TIME_BANDS.filter((band) => timeBands.some((b) => b.id === band.id)).map(
              (band) => (
                <Chip
                  key={band.id}
                  selected={draft.time === band.id}
                  onClick={() => toggle('time', band.id)}
                  className="h-control px-pill"
                >
                  {band.label}
                  <span className="text-caption text-muted-foreground">{band.hint}</span>
                </Chip>
              ),
            ),
          },
        ]
      : []),
    {
      id: 'price',
      title: 'Price',
      hint: 'Cheapest ticket tier',
      activeCount: draft.price ? 1 : 0,
      content: PRICE_OPTIONS.map((option) => (
        <Chip
          key={option.id}
          selected={draft.price === option.id}
          onClick={() => toggle('price', option.id)}
          className="h-control px-pill"
        >
          {option.label}
        </Chip>
      )),
    },
    {
      id: 'category',
      title: 'Category',
      activeCount: draft.category ? 1 : 0,
      content: CATEGORIES.map((category) => (
        <Chip
          key={category.slug}
          selected={draft.category === category.slug}
          onClick={() => toggle('category', category.slug)}
          className="h-control px-pill"
        >
          <category.icon className="size-4" aria-hidden />
          {category.label}
        </Chip>
      )),
    },
    {
      id: 'city',
      title: 'City',
      activeCount: draft.city ? 1 : 0,
      content: POPULAR_CITIES.map((city) => (
        <Chip
          key={city.slug}
          selected={draft.city === city.name}
          onClick={() => toggle('city', city.name)}
          className="h-control px-pill"
        >
          {city.name}
        </Chip>
      )),
    },
    ...(organisers.length
      ? [
          {
            id: 'organiser',
            title: 'Organiser',
            hint: 'From the events loaded so far',
            activeCount: draft.organizer ? 1 : 0,
            content: organisers.map((organiser) => (
              <Chip
                key={organiser.value}
                selected={draft.organizer === organiser.value}
                onClick={() => toggle('organizer', organiser.value)}
                className="h-control max-w-full px-pill"
              >
                <span className="truncate">{organiser.value}</span>
                <span className="text-caption tabular-nums text-muted-foreground">
                  {organiser.count}
                </span>
              </Chip>
            )),
          },
        ]
      : []),
  ];

  const activeSection = sections.find((section) => section.id === paneId) ?? sections[0];

  return (
    <Drawer open={open} onOpenChange={onOpenChange} modal={false}>
      <DrawerContent
        ref={panelRef}
        onKeyDown={(event) => trapTab(event, panelRef.current)}
        side="responsive"
        // `bare`, because the scroll has to live on the section list alone: with
        // the drawer's default scrolling body, the Apply bar scrolls off the
        // bottom of a long filter list and the panel looks like it has no way
        // to commit.
        bare
        aria-label="Filter by"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>Filter by</DrawerTitle>
            <DrawerDescription>
              {count ? `${count} applied` : 'Narrow the list to what you actually want'}
            </DrawerDescription>
          </header>

          {/* -- PHONE: two panes -------------------------------------------
              Seven stacked groups is a long scroll on a 390px screen, and the
              option you want is almost never the one on screen. A list on the
              left and its options on the right makes every group one tap away
              and keeps the panel one screen tall.

              The panes scroll INDEPENDENTLY (`min-h-0` plus `overflow-y-auto`
              on each), so a long city list cannot push the section list out of
              reach -- which is the failure mode of nesting one scroller inside
              another. */}
          <div className="flex min-h-0 flex-1 sm:hidden">
            <nav
              aria-label="Filter sections"
              className="flex w-[38%] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-sunken"
            >
              {sections.map((section) => {
                const isActive = section.id === activeSection?.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setPaneId(section.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'relative flex min-h-control items-center gap-2 px-4 py-3 text-left text-body-sm transition-colors',
                      isActive
                        ? 'bg-surface font-semibold text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {/* The active rail, drawn on the LEFT edge. A background
                        change alone is easy to miss against a tinted column. */}
                    {isActive ? (
                      <span
                        className="absolute inset-y-0 left-0 w-1 rounded-r bg-primary"
                        aria-hidden
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{section.title}</span>
                    {section.activeCount ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4">
              {activeSection ? (
                <>
                  {activeSection.hint ? (
                    <p className="pb-3 text-body-sm text-muted-foreground">{activeSection.hint}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">{activeSection.content}</div>
                </>
              ) : null}
            </div>
          </div>

          {/* -- TABLET AND UP: the stacked panel, unchanged -----------------
              `showRest` still defers the long sections by a frame here, which
              is what keeps the open interaction inside the INP budget. It does
              not apply to the phone layout, where only one section is mounted
              at a time anyway. */}
          <div className="hidden min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto px-6 sm:flex">
            {sections.map((section, index) =>
              index > 2 && !showRest ? null : (
                <Group
                  key={section.id}
                  title={section.title}
                  hint={section.hint}
                  activeCount={section.activeCount}
                >
                  {section.content}
                </Group>
              ),
            )}
          </div>

          <footer
            className="flex shrink-0 items-center gap-3 border-t border-border bg-elevated px-6 pt-card"
            // Safe-area aware: on a phone with a gesture bar the last 34px of
            // the viewport belongs to the system, and Apply sitting under it is
            // a panel with no way to commit.
            style={{ paddingBottom: 'calc(var(--space-card) + env(safe-area-inset-bottom))' }}
          >
            <Button
              variant="ghost"
              className="h-control"
              // `q` survives a clear: the drawer has no search field, and
              // silently dropping a query you cannot see here is a trap.
              onClick={() => setDraft({ ...EMPTY_FILTERS, q: draft.q })}
              disabled={!count}
            >
              <RotateCcw className="size-4" aria-hidden />
              Clear all
            </Button>
            {/* NO second "Close" button. `DrawerContent` already renders the
                one X, and two ways to dismiss on one surface is exactly the
                duplicate-control problem this pass exists to remove. */}
            <Button
              className="ml-auto h-control"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
              disabled={!changed}
            >
              Apply
            </Button>
          </footer>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Group({
  title,
  hint,
  activeCount,
  children,
  className,
}: {
  title: string;
  hint?: string;
  /** How many options in this group are set — drawn beside the heading so a
      collapsed-looking group still reports that it is doing something. */
  activeCount?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Padding on the SECTION rather than gaps between siblings, so the
    // `divide-y` rules sit in the middle of the whitespace instead of hard
    // against the next heading.
    <section className={cn('flex flex-col gap-block py-block-lg', className)} aria-label={title}>
      <div className="flex flex-col gap-stack">
        <div className="flex items-baseline justify-between gap-2">
          {/* A real heading, in the foreground colour.
              It was `text-label uppercase tracking-wide text-muted-foreground`
              — the platform's most de-emphasised style — applied to the one
              element that organises the whole panel. Uppercase muted micro-type
              reads as a caption, so the groups dissolved into one long list of
              chips and the eye had nothing to scan.

              `text-h4`, not `text-h5`: there is no `h5` rung in the type scale
              (display / h1 / h2 / h3 / h4 / body…), so the class generated
              nothing at all and the heading has been rendering at inherited
              body size and weight this whole time — the exact failure the
              comment above says was fixed. */}
          <h3 className="text-h4 text-foreground">{title}</h3>
          {activeCount ? (
            // The warm cream "this is on" pill, matching the toolbar's applied
            // chips, so a group's state and a chip's state look like one idea.
            <span className="shrink-0 rounded-full bg-nav-active px-2 py-0.5 text-caption text-nav-active-foreground">
              {activeCount} selected
            </span>
          ) : null}
        </div>
        {hint ? <p className="text-body-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
