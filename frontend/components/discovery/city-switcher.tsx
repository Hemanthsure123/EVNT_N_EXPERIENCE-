'use client';

import * as React from 'react';
import { ArrowRight, Check, ChevronDown, Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import {
  ALL_CITIES,
  type City,
  POPULAR_CITIES,
  groupCitiesByLetter,
  searchCities,
} from '@/lib/discovery/cities';
import { useLocationContext } from '@/lib/location/location-context';
import type { LocationPrecision, LocationStatus } from '@/lib/location/use-location';
import type { FixFailure } from '@/lib/location/resolve-city';
import { Modal, ModalContent, ModalDescription, ModalTitle } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';

/**
 * The city selector.
 *
 * ── WHAT IT REPLACED, AND WHY THAT MATTERED ───────────────────────────────
 *
 * A ten-chip grid, and "use my current location" was an OFFLINE nearest-match
 * against those same ten coordinates — so somebody in Kochi was told they were
 * in Chennai, confidently, with nothing on screen to suggest it was a guess.
 * Two things fix that: 186 cities to match against (lib/discovery/cities.ts),
 * and a resolver that keeps "we looked it up" and "we picked the nearest one"
 * as DIFFERENT ANSWERS all the way to this component (lib/location/resolve-
 * city.ts). Every branch below says which one it got.
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────
 *
 * Full-screen on a phone, a centred dialog from `sm` — the same decision the
 * filter panel makes, for the same reason: a list of 186 rows on a 360px
 * viewport is the screen, not a thing floating on it.
 *
 * Order is by cost of the alternative: detection first (one press instead of
 * finding your own city in a list), then the ten cities most people want, then
 * everything, A to Z, with a letter rail to jump with.
 *
 * ── KEYBOARD ──────────────────────────────────────────────────────────────
 *
 * The WAI-ARIA combobox pattern, exactly as the search palette does it, and
 * for the same reason: 186 focusable rows would be 186 tab stops between the
 * field and the Close button. The field owns `aria-activedescendant`, the list
 * is a `listbox` of `option`s, and Up/Down/Home/End/Enter/Escape all work.
 * Everything that is NOT an option — detect, the popular chips, the letter
 * rail, "all cities" — is a real `<button>` outside the listbox.
 *
 * Radix's modal mode is kept here (the palette turns it off for INP reasons):
 * this sheet is opened rarely and its body scrolls, so the background scroll
 * lock it brings is load-bearing rather than overhead.
 */

/** Rows tall enough to be a comfortable target, in the 44px control rhythm. */
const ROW_CLASS =
  'flex min-h-control cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-left transition-colors';

export function CitySwitcher({ className }: { className?: string }) {
  const { city, status, precision, fallbackReason, detect, setCity, ready } = useLocationContext();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(-1);
  /**
   * What last moved the highlight — and therefore whether to scroll to it.
   *
   * ── THE BUG THIS FIXES ────────────────────────────────────────────────
   *
   * Every row set `activeIndex` on `mousemove`, and an effect scrolled the
   * active row to the CENTRE of the list. So moving the pointer over a row
   * scrolled that row to the middle, which slid a DIFFERENT row under the
   * stationary cursor, which fired `mousemove` again, which scrolled again.
   * The list ran away under a finger that was not scrolling anything.
   *
   * The rule that ends it: **scrolling to the highlight is for the keyboard
   * only.** Somebody arrowing through a list cannot see past the viewport and
   * needs the row brought to them. Somebody with a pointer is already looking
   * at the row under their cursor — moving it is not help, it is the list
   * fighting them.
   *
   * A ref rather than state on purpose: this must not itself cause a render,
   * and it is read inside the effect that the index change already schedules.
   */
  const moveSource = React.useRef<'keyboard' | 'pointer' | 'open'>('open');
  /** True from pressing Detect until an answer lands — see the effect below. */
  const [awaitingFix, setAwaitingFix] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const headingRefs = React.useRef(new Map<string, HTMLElement>());

  const locating = status === 'locating';
  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  /** Every row currently on screen, in visual order — what the arrows walk. */
  const visible = React.useMemo(
    () => (searching ? searchCities(trimmed) : ALL_CITIES),
    [searching, trimmed],
  );
  const groups = React.useMemo(
    () => (searching ? [] : groupCitiesByLetter(ALL_CITIES)),
    [searching],
  );

  /** Where each letter's first row sits in `visible`, for the rail's jump. */
  const letterStart = React.useMemo(() => {
    const starts = new Map<string, number>();
    let index = 0;
    for (const group of groups) {
      starts.set(group.letter, index);
      index += group.cities.length;
    }
    return starts;
  }, [groups]);

  const choose = React.useCallback(
    (next: City | null) => {
      setCity(next);
      setOpen(false);
    },
    [setCity],
  );

  // A stale search must not survive a close: reopening should present the whole
  // list, not last week's half-typed "chen".
  React.useEffect(() => {
    if (open) setQuery('');
    else setAwaitingFix(false);
  }, [open]);

  /**
   * The highlight is re-derived whenever the list underneath it changes.
   *
   * Both halves matter. While searching it goes to nothing, because an index
   * carried over from the previous query points at a different row and Enter
   * would open somewhere the user never looked. With no query it goes to the
   * city already chosen, so the sheet opens showing where you are rather than
   * at Agartala — and clearing the field returns there rather than leaving a
   * highlight stranded at whatever position the results happened to end on.
   */
  React.useEffect(() => {
    if (!open) return;
    if (searching) {
      setActiveIndex(-1);
      return;
    }
    moveSource.current = 'open';
    setActiveIndex(city ? ALL_CITIES.findIndex((entry) => entry.slug === city.slug) : -1);
  }, [open, searching, trimmed, city]);

  // Keep the highlighted row in view while arrowing, and on open — and NEVER
  // while somebody is moving a pointer over the list. See `moveSource`.
  React.useEffect(() => {
    if (activeIndex < 0 || moveSource.current === 'pointer') return;
    // `center` only when the sheet opens, where centring the currently
    // selected city is genuinely useful. `nearest` for the keyboard, because
    // re-centring on every arrow press makes the whole list jump for a reader
    // who moved one row — the same class of unrequested motion as the bug
    // above, just slower.
    const block = moveSource.current === 'open' ? 'center' : 'nearest';
    const frame = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ block });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, open]);

  /**
   * An EXACT detection closes the sheet; an approximate one does not.
   *
   * A looked-up city needs no confirming — the trigger updates and the job is
   * done. A nearest-match is a guess, and closing on a guess is precisely how
   * somebody ends up browsing the wrong city without ever being told one was
   * made. So the sheet stays open with the sentence and the full list under it.
   */
  React.useEffect(() => {
    if (!awaitingFix || status !== 'granted') return;
    setAwaitingFix(false);
    if (precision === 'exact') setOpen(false);
  }, [awaitingFix, status, precision]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = activeIndex >= 0 ? visible[activeIndex] : visible[0];
      if (picked) choose(picked);
      return;
    }
    if (!visible.length) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveSource.current = 'keyboard';
        setActiveIndex((i) => (i + 1) % visible.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveSource.current = 'keyboard';
        setActiveIndex((i) =>
          i < 0 ? visible.length - 1 : (i - 1 + visible.length) % visible.length,
        );
        break;
      case 'Home':
        event.preventDefault();
        moveSource.current = 'keyboard';
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        moveSource.current = 'keyboard';
        setActiveIndex(visible.length - 1);
        break;
      default:
        break;
    }
  };

  const jumpToLetter = (letter: string) => {
    headingRefs.current.get(letter)?.scrollIntoView({ block: 'start' });
    const start = letterStart.get(letter);
    if (start !== undefined) {
      // The rail scrolls to the HEADING itself, deliberately — so the effect
      // must not then scroll again to the first city under it and undo the
      // alignment somebody just asked for.
      moveSource.current = 'pointer';
      setActiveIndex(start);
    }
  };

  const activeCity = activeIndex >= 0 ? visible[activeIndex] : undefined;
  const notice = detectionNotice(status, precision, fallbackReason, city);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'group inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-body-sm font-medium text-foreground transition-colors duration-fast ease-out hover:bg-muted',
          'active:scale-95 motion-reduce:active:scale-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
      >
        <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
        {/* Until storage has been read, render the neutral label so the server
            HTML and the first client render match exactly.

            The label is hidden below sm because the header row is a width
            budget and this is the cheapest thing in it to cut: at 360px the
            brand, search, city, theme and account together overrun the
            container, and the pin still says what the control does. The city
            itself is stated in full on the surfaces that depend on it — the
            homepage location card and the browse toolbar's city chip.

            `display:none` also removes a node from the accessibility tree, so
            hiding the label would take the city away from a screen reader at
            every width — which is why the spoken name is its own string rather
            than whatever happens to be painted. */}
        <span className="hidden max-w-24 truncate sm:inline" aria-hidden>
          {ready && city ? city.name : 'All cities'}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-base ease-spring group-hover:translate-y-px motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
          aria-hidden
        />
        <span className="sr-only">
          Change city, currently {ready && city ? city.name : 'all cities'}
        </span>
      </button>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          hideClose
          aria-describedby="city-sheet-description"
          onOpenAutoFocus={(event) => {
            // Focus the field, not the first row: typing three letters is
            // faster than scrolling 186 of them, and it is what the pattern
            // above expects to own.
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
          className={cn(
            'left-0 top-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0',
            'sm:left-1/2 sm:top-1/2 sm:h-[min(44rem,86dvh)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
          )}
        >
          {/* ── Pinned header: title, close, and the field ───────────────── */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <ModalTitle>Choose your city</ModalTitle>
                <ModalDescription id="city-sheet-description">
                  We use it to sort what&apos;s near you. It stays on this device.
                </ModalDescription>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="flex h-control items-center gap-2.5 rounded-full border border-input bg-surface px-4">
              <Search className="size-4 shrink-0 text-primary" aria-hidden />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls="city-list"
                aria-activedescendant={activeCity ? `city-option-${activeCity.slug}` : undefined}
                aria-autocomplete="list"
                aria-label="Search for a city or state"
                placeholder="Search for your city"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                autoComplete="off"
                className="h-full w-full bg-transparent text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                  aria-label="Clear"
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          {/* ── Body: the scroller and the letter rail, side by side ─────── */}
          <div className="flex min-h-0 flex-1">
            <div
              ref={scrollRef}
              className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
            >
              {/* Not options, so deliberately OUTSIDE the listbox. */}
              {!searching ? (
                <div className="flex flex-col gap-3 px-2 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAwaitingFix(true);
                      detect();
                    }}
                    disabled={locating}
                    className={cn(
                      'inline-flex h-control w-full items-center gap-2.5 rounded-full border border-border bg-surface px-4 text-label text-foreground transition-colors',
                      'hover:border-border-strong hover:bg-muted disabled:opacity-70',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated',
                    )}
                  >
                    {locating ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
                    ) : (
                      <Crosshair className="size-4 shrink-0 text-primary" aria-hidden />
                    )}
                    {locating ? 'Finding you…' : 'Use my current location'}
                  </button>

                  {notice ? (
                    // `role="status"` so the outcome is announced: the whole
                    // point of the branches is that a guess is stated, and a
                    // sentence nobody hears states nothing.
                    <p role="status" className="text-body-sm text-muted-foreground">
                      {notice}
                    </p>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <p className="text-label uppercase tracking-wide text-foreground-subtle">
                      Popular cities
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {POPULAR_CITIES.map((option) => (
                        <button
                          key={option.slug}
                          type="button"
                          onClick={() => choose(option)}
                          aria-pressed={city?.slug === option.slug}
                          className={cn(
                            'flex h-control items-center rounded-full border px-4 text-left text-body-sm transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated',
                            // "This is the one you're on" — the warm cream pill,
                            // the same vocabulary as an active nav item and an
                            // applied filter.
                            city?.slug === option.slug
                              ? 'border-transparent bg-nav-active text-nav-active-foreground'
                              : 'border-border bg-surface text-foreground hover:bg-muted',
                          )}
                        >
                          <span className="truncate">{option.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div id="city-list" role="listbox" aria-label="All cities" className="pt-2">
                {searching ? (
                  visible.length ? (
                    <div role="group" aria-label={`Results for ${trimmed}`} className="px-1">
                      {visible.map((entry, index) => (
                        <CityOption
                          key={entry.slug}
                          city={entry}
                          selected={city?.slug === entry.slug}
                          active={index === activeIndex}
                          onHover={() => {
                            // Marks the source BEFORE the state change, so the
                            // effect the change schedules already knows not to
                            // scroll. Setting it after would be a render too
                            // late — which is the whole bug.
                            moveSource.current = 'pointer';
                            setActiveIndex(index);
                          }}
                          onSelect={() => choose(entry)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
                      No city matches &ldquo;{trimmed}&rdquo;. Try the state, or a shorter spelling.
                    </p>
                  )
                ) : (
                  groups.map((group) => (
                    <div key={group.letter} role="group" aria-label={group.letter} className="px-1">
                      <p
                        ref={(node) => {
                          if (node) headingRefs.current.set(group.letter, node);
                          else headingRefs.current.delete(group.letter);
                        }}
                        // Sticky against the scroller, on a SOLID surface: the
                        // rows pass underneath it, and a translucent heading
                        // over moving text is unreadable at exactly the moment
                        // it is doing its job.
                        className="sticky top-0 z-10 bg-elevated px-3 py-1.5 text-label uppercase tracking-wide text-foreground-subtle"
                      >
                        {group.letter}
                      </p>
                      {group.cities.map((entry, offset) => {
                        const index = (letterStart.get(group.letter) ?? 0) + offset;
                        return (
                          <CityOption
                            key={entry.slug}
                            city={entry}
                            selected={city?.slug === entry.slug}
                            active={index === activeIndex}
                            onHover={() => {
                            // Marks the source BEFORE the state change, so the
                            // effect the change schedules already knows not to
                            // scroll. Setting it after would be a render too
                            // late — which is the whole bug.
                            moveSource.current = 'pointer';
                            setActiveIndex(index);
                          }}
                            onSelect={() => choose(entry)}
                          />
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/*
              The letter rail.

              A 24x14px target is below the 44px floor the rest of the app holds
              to, and there is no version of an A-Z index that is not a thin
              strip — it has to show 26 letters beside a list without becoming
              the list. The mitigation is that it is a SHORTCUT, never the only
              way: the search field above reaches every one of these rows with
              two keystrokes, and it is what the keyboard and screen-reader path
              uses. Hidden while searching, where the letters index nothing.
            */}
            {!searching ? (
              <nav
                aria-label="Jump to letter"
                className="my-auto mr-1 flex flex-col items-center justify-center rounded-full border border-primary/20 bg-primary/5 px-1 py-2 text-caption font-medium text-primary shadow-xs"
              >
                {groups.map((group) => (
                  <button
                    key={group.letter}
                    type="button"
                    onClick={() => jumpToLetter(group.letter)}
                    aria-label={`Jump to ${group.letter}`}
                    className="flex h-3.5 w-5 items-center justify-center rounded-full text-caption leading-none transition-colors hover:bg-primary/10"
                  >
                    {group.letter}
                  </button>
                ))}
              </nav>
            ) : null}
          </div>

          {/* ── Pinned footer ────────────────────────────────────────────── */}
          <div className="shrink-0 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => choose(null)}
              className={cn(
                'inline-flex h-control w-full items-center justify-center gap-2 rounded-2xl bg-cta text-label text-cta-foreground shadow-sm transition-colors',
                'hover:bg-cta-hover active:bg-cta-active',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-elevated',
              )}
            >
              <span>Show events from all cities</span>
              <ArrowRight className="size-4 shrink-0" aria-hidden />
            </button>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * One row.
 *
 * Highlighting on hover is correct; SCROLLING on hover is not, and the two got
 * coupled through a shared `activeIndex`. The caller now records what moved
 * the highlight and only scrolls for the keyboard — see `moveSource`.
 */
function CityOption({
  city,
  selected,
  active,
  onHover,
  onSelect,
}: {
  city: City;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      id={`city-option-${city.slug}`}
      role="option"
      aria-selected={active}
      data-active={active}
      // `mousemove`, not `mouseenter`: a list that scrolls for its own
      // reasons can slide a new row under a stationary cursor, and
      // `mouseenter` would fire for that — highlighting a row nobody pointed
      // at. `mousemove` only fires when the pointer actually moved.
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        ROW_CLASS,
        selected ? 'bg-primary/10 font-medium' : active ? 'bg-muted' : 'bg-transparent',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate text-body-sm', selected ? 'text-primary font-medium' : 'text-foreground')}>
        {city.name}
      </span>
      {/* The state is the disambiguator, not decoration — there is an Aurangabad
          in two states and a Bilaspur in three. */}
      <span className="shrink-0 truncate text-caption text-muted-foreground">{city.state}</span>
      {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
    </div>
  );
}

/**
 * One sentence for every way detection can end, and never a spinner left
 * running or a city presented as certain when it is not.
 *
 * Returns null when there is nothing worth saying — an exact match closes the
 * sheet, so the only silence here is "you have not asked yet".
 */
function detectionNotice(
  status: LocationStatus,
  precision: LocationPrecision,
  because: FixFailure | null,
  city: City | null,
): string | null {
  if (status === 'denied') {
    return 'Location permission is off for this site, so we can’t detect your city. Pick one below — you can re-enable it in your browser’s site settings.';
  }
  if (status === 'unsupported') {
    return 'This browser can’t share a location. Pick a city below instead.';
  }
  if (status === 'unavailable') {
    return 'Your device couldn’t get a location just now. Try again, or pick a city below.';
  }
  if (status === 'unserved') {
    return 'We couldn’t match where you are to a city we list. Pick one below.';
  }
  if (status === 'granted' && precision === 'approximate' && city) {
    // The three reasons are genuinely different facts and the sentence says
    // which one it is: an authorisation refusal is ours to fix, an outage is
    // temporary, and an unmatched place name is neither.
    const tail = ' Change it below if that’s not right.';
    if (because === 'refused') {
      return `${city.name} is the nearest city we list to where you are. We couldn’t confirm the exact name — looking one up needs a signed-in account today.${tail}`;
    }
    if (because === 'unavailable') {
      return `${city.name} is the nearest city we list to where you are. Place lookup is unavailable right now, so this is a match by distance.${tail}`;
    }
    return `${city.name} is the nearest city we list to where you are — we don’t have events listed under the place name we got back.${tail}`;
  }
  return null;
}
