'use client';

import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DatePicker } from './date-picker';
import {
  Drawer,
  DrawerClose,
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
  const panelRef = React.useRef<HTMLDivElement>(null);
  useBackgroundInert(open);

  // Re-seed each time it opens: a chip toggled in the toolbar while the drawer
  // was shut must be reflected, and a discarded draft must not come back.
  React.useEffect(() => {
    if (open) setDraft(filters);
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
        aria-label="All filters"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>All filters</DrawerTitle>
            <DrawerDescription>
              {count ? `${count} applied` : 'Narrow the list to what you actually want'}
            </DrawerDescription>
          </header>

          <div className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto px-6">
            <Group
              title="Date"
              hint="When you want to go"
              activeCount={(draft.when ? 1 : 0) + (draft.dateFrom ? 1 : 0)}
            >
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
              {/* The same control as the toolbar, so a range can be chosen
                  from either surface and neither is the "real" one. Picking
                  explicit dates clears the named window — the two would
                  otherwise contradict each other in the URL. */}
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
            </Group>

            {timeBands.length ? (
              <Group title="Time of day" hint="Start time, IST">
                {TIME_BANDS.filter((band) => timeBands.some((b) => b.id === band.id)).map(
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
                )}
              </Group>
            ) : null}

            <Group title="Price" hint="Cheapest ticket tier">
              {PRICE_OPTIONS.map((option) => (
                <Chip
                  key={option.id}
                  selected={draft.price === option.id}
                  onClick={() => toggle('price', option.id)}
                  className="h-control px-pill"
                >
                  {option.label}
                </Chip>
              ))}
            </Group>

            {showRest ? (
              <>
                <Group title="Category">
                  {CATEGORIES.map((category) => (
                    <Chip
                      key={category.slug}
                      selected={draft.category === category.slug}
                      onClick={() => toggle('category', category.slug)}
                      className="h-control px-pill"
                    >
                      <category.icon className="size-4" aria-hidden />
                      {category.label}
                    </Chip>
                  ))}
                </Group>

                <Group title="City">
                  {POPULAR_CITIES.map((city) => (
                    <Chip
                      key={city.slug}
                      selected={draft.city === city.name}
                      onClick={() => toggle('city', city.name)}
                      className="h-control px-pill"
                    >
                      {city.name}
                    </Chip>
                  ))}
                </Group>

                {organisers.length ? (
                  <Group title="Organiser" hint="From the events loaded so far">
                    {organisers.map((organiser) => (
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
                    ))}
                  </Group>
                ) : null}

                <Group title="Sort">
                  {SORT_OPTIONS.map((option) => (
                    <Chip
                      key={option.id}
                      selected={draft.sort === option.id}
                      onClick={() =>
                        setDraft((current) => ({ ...current, sort: option.id as SortId }))
                      }
                      className="h-control px-pill"
                    >
                      {option.label}
                    </Chip>
                  ))}
                </Group>
              </>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-elevated px-6 py-card">
            <Button
              variant="ghost"
              className="h-control"
              // `q` survives a reset: the drawer has no search field, and
              // silently dropping a query you can't see here is a trap.
              onClick={() => setDraft({ ...EMPTY_FILTERS, q: draft.q })}
              disabled={!count}
            >
              <RotateCcw className="size-4" aria-hidden />
              Reset
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="ml-auto h-control">
                Close
              </Button>
            </DrawerClose>
            <Button
              className="h-control"
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
