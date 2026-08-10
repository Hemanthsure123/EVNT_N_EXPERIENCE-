'use client';

import * as React from 'react';
import { Check, ChevronDown, MapPin, Search } from 'lucide-react';
import { ALL_CITIES, searchCities, type City } from '@/lib/discovery/cities';
import { cn } from '@/lib/utils/cn';

/**
 * Any city in India, findable — not just the handful on the chip row.
 *
 * ── WHY A COMBOBOX AND NOT THE `<datalist>` THIS REPLACED ─────────────────
 *
 * The field was a plain input with a `datalist` of all 186 cities. That is
 * genuinely native, keyboard-accessible and free-text — and it was reported as
 * "no option for choosing a city apart from the top cities", which is a fair
 * reading of what it looks like: a `datalist` renders NOTHING until somebody
 * types, so a form showing nine chips and a box appears to offer nine choices.
 * An affordance nobody can see is not an affordance.
 *
 * The WAI-ARIA guidance is explicit about the fix — when the combobox takes
 * focus, the listbox expands to show the options — so pressing the field shows
 * the whole list immediately and typing filters it.
 *
 * ── IT STAYS FREE TEXT ────────────────────────────────────────────────────
 *
 * `onChange` fires on every keystroke, not only on selection. Somebody in a
 * town that is not in the list can still type it and be heard; the list is a
 * shortcut, never a gate. This is the same reason the original `datalist` was
 * chosen, and dropping it would have been a regression dressed as an upgrade.
 *
 * Same ARIA shape as `discovery/city-switcher`, which already searches all 186
 * — one combobox behaviour in the product rather than two.
 */

const MAX_VISIBLE = 60;

export function CityCombobox({
  id,
  value,
  onChange,
  placeholder = 'Start typing a city',
  className,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;

  // The whole list when nothing is typed — that IS the fix. Capped because a
  // 186-row popover is a scroll container nobody reads to the end of; typing
  // one letter is faster than scrolling past Agra.
  const matches = React.useMemo(() => {
    const found = value.trim() ? searchCities(value) : ALL_CITIES;
    return found.slice(0, MAX_VISIBLE);
  }, [value]);

  React.useEffect(() => setActive(0), [value]);

  // Close on an outside press. `pointerdown`, not `click`: a press that starts
  // outside and ends inside should still close, and it fires before focus
  // moves.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (city: City) => {
    onChange(city.name);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + matches.length) % Math.max(matches.length, 1));
      return;
    }
    if (event.key === 'Enter' && open && matches[active]) {
      // Only when the listbox is open AND something is highlighted. Otherwise
      // Enter belongs to the form, and swallowing it would break submitting by
      // keyboard from a field somebody has already filled in.
      event.preventDefault();
      choose(matches[active]);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className="relative">
        <MapPin
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-10 text-body-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Hide cities' : 'Show all cities'}
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-fast', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Cities"
          className="absolute z-dropdown mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-elevated p-1 shadow-lg"
        >
          {matches.length === 0 ? (
            // Not an error. The field takes free text, so a name nothing
            // matches is a town we do not list, not a mistake to correct.
            <li className="flex items-center gap-2 px-3 py-2 text-body-sm text-muted-foreground">
              <Search className="size-4 shrink-0" aria-hidden />
              Not in our list — type it and carry on.
            </li>
          ) : (
            matches.map((city, index) => {
              const selected = city.name === value;
              return (
                <li key={city.slug}>
                  <button
                    id={`${id}-opt-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onPointerDown={(event) => {
                      // Before blur, so the press lands on the option rather
                      // than closing the list out from under the cursor.
                      event.preventDefault();
                      choose(city);
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body-sm',
                      index === active ? 'bg-muted text-foreground' : 'text-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {city.name}
                      {city.state ? (
                        <span className="text-muted-foreground"> · {city.state}</span>
                      ) : null}
                    </span>
                    {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
