'use client';

import * as React from 'react';
import { ArrowUpDown, LayoutGrid, Rows3, SlidersHorizontal, X } from 'lucide-react';
import { Container } from '@/components/shell/container';
import { Chip } from '@/components/ui/chip';
import { DatePicker } from './date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORIES } from '@/lib/discovery/categories';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import type { DateWindowId } from '@/lib/discovery/date-windows';
import {
  type ActiveFilterChip,
  type DiscoveryFilters,
  EMPTY_FILTERS,
  type PriceBandId,
  SORT_OPTIONS,
  type SortId,
  activeFilterChips,
  clearFilter,
} from '@/lib/discovery/filters';
import { cn } from '@/lib/utils/cn';
import { OverflowRow, type OverflowItem } from './overflow-row';
import type { ViewMode } from '@/lib/discovery/use-view-mode';

/**
 * The browse page's control surface: one sticky row, in the order the eye needs
 * it — scope (Filters), the shortcuts people actually use (date, price,
 * category), then where/how the results are ordered and shown.
 *
 * It sticks under the site header rather than scrolling away, because filtering
 * is not a one-time decision on a list you keep scrolling: you narrow, scan,
 * narrow again. Losing the controls after one screenful forces a scroll back up
 * for every adjustment.
 *
 * NOTHING HERE SCROLLS SIDEWAYS. The chip run is an `OverflowRow`, which
 * measures what fits and moves the remainder into "More" — so at 1440px the row
 * shows every category, at 1024px it shows six, and on a phone it shows two,
 * with the rest one tap away in the same drawer that holds the full filter set.
 * There is no width at which a filter is unreachable, and no width at which a
 * scrollbar appears.
 *
 * The controls that must not be trimmed (sort, count, view) live outside the
 * measured row and drop to the drawer by breakpoint instead — they're
 * fixed-width, so a breakpoint is honest for them in a way it isn't for text.
 *
 * THE BAR IS A FIXED TWO LINES, and the second one is never conditional. It used
 * to appear only once a filter was applied, which grew the sticky bar and pushed
 * the entire grid down — a 0.068 layout shift, measured, on the single most
 * common interaction the page has. So the row is always there and always says
 * something: the applied filters when there are any, how the list is ordered
 * when there aren't. Same height either way, nothing moves, and the result count
 * gets a stable home instead of competing for space on the first line.
 *
 * ── THREE STATES, THREE COLOURS, AND THEY ARE NOT INTERCHANGEABLE ─────────
 *
 *   "Filters" with something applied   NEAR-BLACK pill (`--cta`)
 *       the page's one primary action — open the full set.
 *   An applied filter chip             WARM CREAM pill (`--nav-active`)
 *       "this is on". Quiet, unsaturated, and deliberately NOT the action
 *       colour: a row of black pills would each claim to be the thing to press.
 *   The view toggle's pressed half     NEAR-BLACK fill
 *       a real selected state on a control that has exactly two options.
 *
 * The violet that used to carry all three is gone from this bar entirely. It
 * is the wayfinding accent now, and a filter bar is not wayfinding.
 *
 * `.glass` stays on the bar itself: this is genuinely floating chrome with
 * content scrolling underneath it, which is the one thing the frost is for.
 * On a white page its HAIRLINE is what says the bar is there, not its fill.
 */

const WHEN_CHIPS: { id: DateWindowId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'weekend', label: 'This weekend' },
];

const PRICE_CHIPS: { id: PriceBandId; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'under-500', label: 'Under ₹500' },
];

const ALL_CITIES = '__all__';
const sortLabel = (sort: SortId) => SORT_OPTIONS.find((option) => option.id === sort)?.label ?? '';
/** Must match the row's `gap-2` (8px) so measurement matches layout. */
const ROW_GAP_PX = 8;

export function FilterToolbar({
  filters,
  onChange,
  onOpenFilters,
  resultLabel,
  view,
  onViewChange,
}: {
  filters: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  /** Opens the full slide-over. */
  onOpenFilters: () => void;
  /** e.g. "24+ events" — announced politely as the results change. */
  resultLabel: string;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}) {
  const chips = activeFilterChips(filters);
  const activeCount = chips.length + (filters.sort === 'soonest' ? 0 : 1);

  const toggle = <K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) =>
    onChange({ ...filters, [key]: filters[key] === value ? null : value });

  // Brief order: date -> price -> categories. Categories are last because
  // they're the ones that should give way first when space runs out.
  const items = React.useMemo<OverflowItem[]>(
    () => [
      ...WHEN_CHIPS.map((chip) => ({
        key: `when-${chip.id}`,
        node: (
          <Chip selected={filters.when === chip.id} onClick={() => toggle('when', chip.id)}>
            {chip.label}
          </Chip>
        ),
      })),
      // Beside the named windows, not instead of them: "Today" answers the
      // common question in one tap, and the calendar answers the one the
      // chips cannot express at all.
      {
        key: 'date-picker',
        node: (
          <DatePicker
            from={filters.dateFrom}
            to={filters.dateTo}
            onApply={({ from, to }) =>
              // Choosing explicit dates clears the named window, so the two
              // never contradict each other in the URL.
              onChange({ ...filters, when: from ? null : filters.when, dateFrom: from, dateTo: to })
            }
          />
        ),
      },
      ...PRICE_CHIPS.map((chip) => ({
        key: `price-${chip.id}`,
        node: (
          <Chip selected={filters.price === chip.id} onClick={() => toggle('price', chip.id)}>
            {chip.label}
          </Chip>
        ),
      })),
      ...CATEGORIES.map((category) => ({
        key: `category-${category.slug}`,
        node: (
          <Chip
            selected={filters.category === category.slug}
            onClick={() => toggle('category', category.slug)}
          >
            <category.icon className="size-3.5" aria-hidden />
            {category.label}
          </Chip>
        ),
      })),
    ],
    // `toggle` closes over `filters`; listing it is what keeps the chips live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters],
  );

  return (
    <div
      className={cn(
        'sticky top-14 z-sticky border-y border-border',
        // One real backdrop-filter on the page's one sticky bar — the same
        // exception the site header gets. Cards use `.glass-media` instead.
        'glass',
      )}
    >
      <Container className="flex flex-col">
        <div className="flex min-w-0 items-center gap-3 py-3">
          <button
            type="button"
            onClick={onOpenFilters}
            aria-label={activeCount ? `All filters, ${activeCount} applied` : 'All filters'}
            className={cn(
              // `px-pill` rather than a picked number — the pill padding token
              // every call to action in the product shares.
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-pill text-label',
              'transition duration-fast ease-out active:scale-95',
              'motion-reduce:transition-none motion-reduce:active:scale-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              // THE BLACK PILL once anything is applied — this is the browse
              // page's one primary action, and `--cta` is what makes it the
              // same object as every other primary action in the product.
              activeCount
                ? 'border-cta bg-cta text-cta-foreground hover:bg-cta-hover'
                : 'border-border bg-surface text-foreground hover:bg-muted',
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {activeCount ? (
              // `cta-foreground/20`, NOT `on-gradient/20`. The pill inverts to
              // near-WHITE in dark theme, and white-at-20% on white is nothing
              // at all; this tints with whatever the label's colour is, so the
              // counter is a readable chip in both themes.
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-cta-foreground/20 text-caption tabular-nums">
                {activeCount}
              </span>
            ) : null}
          </button>

          <span className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />

          <OverflowRow
            items={items}
            gapPx={ROW_GAP_PX}
            renderMore={(hidden) => (
              <button
                type="button"
                onClick={onOpenFilters}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-border bg-surface px-4 text-label text-muted-foreground',
                  'transition-colors duration-fast hover:border-border-strong hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                More filters
                <span className="tabular-nums">{hidden.length}</span>
              </button>
            )}
          />

          <span className="hidden h-6 w-px shrink-0 bg-border xl:block" aria-hidden />

          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <label htmlFor="filter-city" className="sr-only">
              City
            </label>
            <Select
              value={filters.city ?? ALL_CITIES}
              onValueChange={(value) =>
                onChange({ ...filters, city: value === ALL_CITIES ? null : value })
              }
            >
              <SelectTrigger id="filter-city" className="h-9 w-36 rounded-full text-body-sm">
                <SelectValue placeholder="All cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CITIES}>All cities</SelectItem>
                {POPULAR_CITIES.map((city) => (
                  <SelectItem key={city.slug} value={city.name}>
                    {city.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />
            <label htmlFor="filter-sort" className="sr-only">
              Sort results
            </label>
            <Select
              value={filters.sort}
              onValueChange={(value) => onChange({ ...filters, sort: value as SortId })}
            >
              <SelectTrigger id="filter-sort" className="h-9 w-40 rounded-full text-body-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ViewToggle view={view} onChange={onViewChange} />
        </div>

        <div className="flex h-12 min-w-0 items-center gap-2 border-t border-border">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {chips.length ? (
              <>
                <span className="shrink-0 text-caption uppercase tracking-wide text-muted-foreground">
                  Active
                </span>
                {chips.map((chip: ActiveFilterChip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => onChange(clearFilter(filters, chip.key))}
                    className={cn(
                      // The APPLIED state is the warm butter/cream pill, not a
                      // violet fill: "this is on" and "press me" have to look
                      // like different things, and the near-black pill is
                      // reserved for the action.
                      'inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-nav-active px-3 text-label text-nav-active-foreground',
                      'transition-colors duration-fast hover:bg-nav-active-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <span className="truncate">{chip.label}</span>
                    <X className="size-3.5 shrink-0" aria-hidden />
                    <span className="sr-only">Remove filter</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q })}
                  className="shrink-0 rounded-md px-2 py-1 text-label text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear all
                </button>
              </>
            ) : (
              <p className="truncate text-body-sm text-muted-foreground">
                {`No filters applied · ${sortLabel(filters.sort).toLowerCase()}`}
              </p>
            )}
          </div>

          <p
            className="shrink-0 whitespace-nowrap text-body-sm tabular-nums text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {resultLabel}
          </p>
        </div>
      </Container>
    </div>
  );
}

/**
 * Grid or list. Not decoration: a 3-up grid is for scanning by poster, a list is
 * for COMPARING — same date, price and venue at the same x-position down the
 * page, which a staggered grid can't give you. The choice persists, because it's
 * a preference about how someone reads, not about this one query.
 */
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  const options: { id: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'grid', label: 'Grid view', icon: LayoutGrid },
    { id: 'list', label: 'List view', icon: Rows3 },
  ];

  return (
    <div
      role="group"
      aria-label="Result layout"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={view === option.id}
          aria-label={option.label}
          onClick={() => onChange(option.id)}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full transition duration-fast ease-spring',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'motion-reduce:transition-none',
            // Near-black fill, label in the token that FLIPS with the theme —
            // `on-gradient` is white in both, and the dark theme's fill is
            // near-white.
            view === option.id
              ? 'bg-cta text-cta-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <option.icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
