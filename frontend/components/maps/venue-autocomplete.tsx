'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Search, X } from 'lucide-react';
import {
  fetchMapsConfig,
  fetchPlaceDetail,
  fetchPlaceSuggestions,
  type PlaceSuggestion,
} from '@/lib/api/maps';
import { cn } from '@/lib/utils/cn';

/**
 * The organizer's venue picker.
 *
 * ── WHAT IT WRITES, AND WHY ALL FOUR TOGETHER ─────────────────────────────
 *
 * Picking a suggestion sets `venue`, `city`, `place_id`, `latitude` and
 * `longitude` in one go. The last three are what make the event page's map
 * real: without them the page falls back to an address and a directions
 * link, which is honest but plainer.
 *
 * ── TYPING FREEHAND IS STILL ALLOWED ──────────────────────────────────────
 *
 * A venue that Google has never heard of — a farm, a new space, a private
 * address — must still be listable. So this is an input with suggestions,
 * not a select: typing writes `venue` and clears the coordinates, because a
 * name that no longer matches the pinned place must not keep that pin.
 *
 * ── THE SESSION TOKEN IS A BILLING CONTROL ────────────────────────────────
 *
 * Google bills autocomplete per SESSION when one token groups the keystrokes
 * with the final Place Details call, and per REQUEST when it does not. One
 * token is minted per picking session and discarded after the Details call,
 * which is the difference between one billed session and one bill per
 * keypress.
 */

export type VenueSelection = {
  venue: string;
  city: string;
  place_id: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  value: string;
  city?: string;
  onChange: (selection: VenueSelection) => void;
  /** ISO 3166-1 alpha-2, lowercase. Biases suggestions to one country. */
  country?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/** A UUID for Google's session token. `crypto.randomUUID` where available. */
function newSessionToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function VenueAutocomplete({
  value,
  city = '',
  onChange,
  country = 'in',
  id = 'venue',
  placeholder = 'Search for a venue, or type your own',
  disabled,
  className,
}: Props) {
  const [query, setQuery] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sessionToken = React.useRef(newSessionToken());
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setQuery(value), [value]);

  const config = useQuery({
    queryKey: ['maps', 'config'],
    queryFn: fetchMapsConfig,
    staleTime: 600_000,
    retry: 1,
  });
  const mapsAvailable = config.data?.available === true;

  // Debounced. Autocomplete is billed per keystroke without a session token
  // and this is a paid API either way — 250ms is below the threshold where
  // typing feels laggy and well above one request per character.
  const [debounced, setDebounced] = React.useState(query);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const suggestions = useQuery({
    queryKey: ['maps', 'autocomplete', debounced, country],
    queryFn: () =>
      fetchPlaceSuggestions({
        q: debounced,
        session_token: sessionToken.current,
        country,
        // Businesses AND addresses: a venue is often neither purely one.
        types: 'establishment|geocode',
      }),
    // Below two characters Google returns noise and still bills for it.
    enabled: mapsAvailable && open && debounced.trim().length >= 2,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    const onClickAway = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const handleType = (next: string) => {
    setQuery(next);
    setOpen(true);
    setError(null);
    if (pinned) {
      // The name no longer matches the pinned place, so the pin is now a lie
      // about a different building. Cleared rather than kept.
      setPinned(false);
      onChange({ venue: next, city, place_id: '', latitude: null, longitude: null });
    } else {
      onChange({ venue: next, city, place_id: '', latitude: null, longitude: null });
    }
  };

  const pick = async (suggestion: PlaceSuggestion) => {
    setOpen(false);
    setResolving(true);
    setError(null);
    try {
      const place = await fetchPlaceDetail(suggestion.place_id, sessionToken.current);
      setQuery(place.name || suggestion.main_text);
      setPinned(true);
      onChange({
        venue: place.name || suggestion.main_text,
        city: place.city || city,
        place_id: place.place_id,
        latitude: place.latitude,
        longitude: place.longitude,
      });
    } catch {
      // Named, not swallowed. The organizer can still type the venue by hand;
      // they just do not get the pin.
      setError('Could not load that place. You can still type the venue yourself.');
      setQuery(suggestion.main_text);
      onChange({
        venue: suggestion.main_text,
        city,
        place_id: '',
        latitude: null,
        longitude: null,
      });
    } finally {
      setResolving(false);
      // A new session for the next pick — the old token is spent.
      sessionToken.current = newSessionToken();
    }
  };

  const rows = suggestions.data?.data ?? [];

  return (
    <div ref={containerRef} className={cn('relative flex flex-col gap-1.5', className)}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden>
          {resolving ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : pinned ? (
            <Check className="size-4 text-success-subtle-foreground" />
          ) : (
            <Search className="size-4 text-muted-foreground" />
          )}
        </span>
        <input
          id={id}
          value={query}
          onChange={(event) => handleType(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-autocomplete="list"
          aria-controls={`${id}-suggestions`}
          className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear venue"
            onClick={() => {
              setQuery('');
              setPinned(false);
              onChange({ venue: '', city, place_id: '', latitude: null, longitude: null });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && rows.length > 0 ? (
        <ul
          id={`${id}-suggestions`}
          role="listbox"
          className="absolute top-full z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {rows.map((suggestion) => (
            <li key={suggestion.place_id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => void pick(suggestion)}
                className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-medium">
                    {suggestion.main_text}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {suggestion.secondary_text}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* States that change what the organizer should expect, each said once. */}
      {!mapsAvailable && !config.isPending ? (
        <p className="text-caption text-muted-foreground">
          Venue search is unavailable on this deployment — type the venue name and city, and the
          event page will show an address and a directions link instead of a map.
        </p>
      ) : pinned ? (
        <p className="text-caption text-success-subtle-foreground">
          Pinned. The event page will show a map with this location.
        </p>
      ) : query.trim() ? (
        <p className="text-caption text-muted-foreground">
          Not pinned to a place, so the event page will show the address without a map. Pick a
          suggestion to add one.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
