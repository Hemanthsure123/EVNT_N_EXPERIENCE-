'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { fetchModerationQueue, type ModerationEntry } from '@/lib/api/admin';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { cn } from '@/lib/utils/cn';

/**
 * Pick one event, by typing its name.
 *
 * ── WHY IT IS A SEARCH AND NOT A `<select>` ───────────────────────────────
 *
 * A platform has thousands of events. A native select would need every one of
 * them in the DOM, and the endpoint behind it is cursor-paginated — so the
 * list would silently be "the first 25, oldest first", which is the worst
 * possible 25 to choose from. Somebody looking for last night's show would
 * conclude it does not exist.
 *
 * So this queries the server on every keystroke (debounced) against the same
 * substring search the All-events queue uses — title, venue, city or
 * organiser. Typing is how you find one; there is nothing to scroll.
 *
 * ── IT RESOLVES A NAME TO AN ID BEFORE FILTERING ──────────────────────────
 *
 * The caller filters on `event_id`, never on the text. Two events genuinely
 * share a title — a Saturday and a Sunday night of the same show — and a
 * revenue figure that silently summed both is worse than no filter at all.
 * That is why the chosen event is held as `{id, title}` rather than a string.
 */

export type PickedEvent = { id: string; title: string };

export function EventPicker({
  value,
  onChange,
  className,
}: {
  value: PickedEvent | null;
  onChange: (event: PickedEvent | null) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const query = useQuery({
    // `status: ''` is the ALL tab — a booking can belong to an event that is
    // finished, archived or sent back, and a picker that only offered live
    // ones would be unable to find most of what an operator is looking for.
    queryKey: ['admin', 'event-picker', search],
    queryFn: () => fetchModerationQueue({ status: undefined, q: search || undefined }),
    enabled: open,
    staleTime: 30_000,
  });

  const rows: ModerationEntry[] = query.data?.data ?? [];

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex h-control max-w-64 items-center gap-2 rounded-full border px-4 text-body-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          // The applied state wears the same butter pill every other filter on
          // this platform uses — a filter that looks identical whether or not
          // it is filtering is how somebody loses five minutes to missing rows.
          value
            ? 'border-nav-active bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
            : 'border-input bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <span className="min-w-0 truncate">{value ? value.title : 'Any event'}</span>
        {value ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear the event filter"
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onChange(null);
              }
            }}
            className="-mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-nav-active-foreground/15"
          >
            <X className="size-3.5" aria-hidden />
          </span>
        ) : (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-dropdown w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="relative border-b border-border">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Event, venue, city or organiser"
              aria-label="Search events"
              className="h-control w-full bg-transparent pl-10 pr-3 text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul role="listbox" className="max-h-72 overflow-y-auto overscroll-contain p-1">
            {query.isPending ? (
              <li className="flex items-center gap-2 px-3 py-4 text-body-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Searching…
              </li>
            ) : rows.length === 0 ? (
              <li className="px-3 py-4 text-body-sm text-muted-foreground">
                {search ? 'Nothing matches that.' : 'No events on the platform yet.'}
              </li>
            ) : (
              rows.map((row) => {
                const selected = value?.id === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange({ id: row.id, title: row.title });
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full min-h-control items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                        selected ? 'bg-nav-active' : 'hover:bg-muted',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm font-medium text-foreground">
                          {row.title}
                        </span>
                        {/* The disambiguator, and it is not decoration: two
                            events share a title often enough that a picker
                            without this makes somebody guess. */}
                        <span className="block truncate text-caption text-muted-foreground">
                          {row.city} ·{' '}
                          {new Date(row.starts_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </span>
                      {selected ? (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
