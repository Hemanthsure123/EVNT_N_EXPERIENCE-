'use client';

import * as React from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import {
  DESCRIPTION_SOFT_MAX,
  CITY_MAX,
  TITLE_MAX,
  VENUE_MAX,
  toLocalInput,
  type Draft,
  type Issue,
} from '@/lib/organizer/wizard/model';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { directionsUrl } from '@/lib/api/maps';
import { Button } from '@/components/ui';
import { PinPicker } from '@/components/maps/pin-picker';
import { VenueAutocomplete, type VenueSelection } from '@/components/maps/venue-autocomplete';
import { cn } from '@/lib/utils/cn';
import {
  DateField,
  FieldFrame,
  NeedsSavedDraft,
  Section,
  SelectField,
  StepHeader,
  TextArea,
  TextField,
  fieldMessageId,
  type DraftSave,
} from './fields';
import { missingForSave } from './details-step';
import { CATEGORIES } from '@/lib/discovery/categories';
import { CategoryScene } from '@/components/illustrations/category-scenes';
import { SessionsEditor } from '@/components/organizer/wizard/sessions-editor';
import { RunningOrder } from './running-order';

type StepProps = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  issues: Issue[];
  /** The save engine's health, for a NeedsSavedDraft panel's honest closing
   *  line. Only the steps that render one receive it. */
  save?: DraftSave;
};

const errorFor = (issues: Issue[], field: string) =>
  issues.find((issue) => issue.field === field)?.message;

/* ─────────────────────────────── basics ─────────────────────────────── */

/**
 * The organisation picker appears ONLY when there is a choice to make.
 *
 * Most accounts own exactly one, and for them the hook has already adopted it
 * — a select with a single option is a question nobody needs asked, so it is
 * not rendered at all. When there are several, picking the first one silently
 * is a guess that attaches an event, its ticket revenue and its payouts to the
 * wrong company, so the organizer is asked instead, and nothing saves until
 * they answer.
 *
 * It locks once the event exists on the server: `organization_id` is set by
 * `POST /events` and is not in the PATCH body, so a control that still moved
 * afterwards would change this preview and nothing else.
 */
export function BasicsStep({
  draft,
  update,
  issues,
  organizations,
}: StepProps & { organizations: readonly { id: string; name: string }[] }) {
  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Basics"
      />

      {organizations.length > 1 ? (
        <SelectField
          id="event-organization"
          label="Organisation"
          value={draft.organizationId}
          onChange={(organizationId) => update({ organizationId })}
          options={organizations.map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
          placeholder="Choose an organisation"
          disabled={Boolean(draft.eventId)}
          error={errorFor(issues, 'organizationId')}
          hint={
            draft.eventId
              ? 'Fixed once the draft exists — the event belongs to this organisation now.'
              : 'It receives the payouts and its verification is what lets the event go live.'
          }
        />
      ) : null}

      <TextField
        id="event-title"
        label="Event title"
        value={draft.title}
        onChange={(title) => update({ title })}
        placeholder="Sunburn Arena ft. Martin Garrix"
        max={TITLE_MAX}
        error={errorFor(issues, 'title')}
        autoFocus
      />

      <TextArea
        id="event-description"
        label="Description"
        value={draft.description}
        onChange={(description) => update({ description })}
        placeholder="What happens, who is playing, what is included, and anything an attendee needs to know before buying."
        softMax={DESCRIPTION_SOFT_MAX}
      />

      <Section
        title="Category"
      >
        <CategoryPicker value={draft.category} onChange={(category) => update({ category })} />
      </Section>

    </div>
  );
}

/* ──────────────────────────────── venue ─────────────────────────────── */

/**
 * Where it happens — a search, a city, and a pin.
 *
 * ── THE VENUE IS A PLACE PICKER, AND STILL A TEXT FIELD ───────────────────
 *
 * `VenueAutocomplete` writes `venue`, `city`, `placeId` and both coordinates in
 * one go when a Google suggestion is picked, and behaves as a plain text input
 * when it is not — a farm, a new space or a private address must still be
 * listable. It degrades itself: with no server Maps key it says so and takes
 * typing only, so this step never has a dead search box in it.
 *
 * ── WHEN THE PIN SURVIVES AN EDIT TO THE NAME ─────────────────────────────
 *
 * Typing over a PICKED place clears its coordinates, because a name that no
 * longer matches the pinned place would leave the map on another building. A pin
 * the organizer DROPPED BY HAND is different — they chose it for this venue, and
 * fixing a typo in the name is not a reason to throw it away. So only the
 * picker's own pin is cleared by typing; a hand-placed one is cleared by the pin
 * control, which is the thing that placed it.
 *
 * That is also the invariant `Draft.placeId` documents: a non-empty place id
 * means the coordinates are GOOGLE'S for that place, so a hand-dropped pin
 * always clears it.
 */
export function VenueStep({ draft, update, issues }: StepProps) {
  const mapsQuery = [draft.venue, draft.city].filter(Boolean).join(', ');
  const venueError = errorFor(issues, 'venue');
  /** The saved pin, as the shared `directionsUrl` wants it. Narrowed once here
   *  rather than asserted at the call site — the pair is either whole or absent. */
  const pin =
    draft.latitude !== null && draft.longitude !== null
      ? { latitude: draft.latitude, longitude: draft.longitude }
      : null;

  const pickVenue = (selection: VenueSelection) => {
    const handPlaced = draft.placeId === '' && draft.latitude !== null && draft.longitude !== null;
    // A cleared selection (typing, or the field's own clear button) never
    // carries coordinates; a picked place always does. So "keep what we have"
    // is exactly "this selection dropped a pin AND the pin was ours to keep".
    const keepPin = handPlaced && selection.place_id === '' && selection.latitude === null;
    update({
      venue: selection.venue.slice(0, VENUE_MAX),
      // A picked place names its own city; a typed one reports back whatever is
      // already in the field, so this never blanks a city somebody chose.
      city: selection.city || draft.city,
      placeId: selection.place_id,
      latitude: keepPin ? draft.latitude : selection.latitude,
      longitude: keepPin ? draft.longitude : selection.longitude,
    });
  };

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Venue"
      />

      <FieldFrame
        id="event-venue"
        label="Venue"
        count={{ used: draft.venue.length, max: VENUE_MAX }}
        error={venueError}
      >
        <VenueAutocomplete
          id="event-venue"
          value={draft.venue}
          city={draft.city}
          onChange={pickVenue}
          describedBy={fieldMessageId('event-venue', venueError)}
          invalid={Boolean(venueError)}
        />
      </FieldFrame>

      <div className="flex flex-col gap-1.5">
        <TextField
          id="event-city"
          label="City"
          value={draft.city}
          onChange={(city) => update({ city })}
          placeholder="Mumbai"
          max={CITY_MAX}
          error={errorFor(issues, 'city')}
        />
        <ul className="flex flex-wrap gap-1.5">
          {POPULAR_CITIES.slice(0, 8).map((city) => (
            <li key={city.name}>
              <CityChip
                name={city.name}
                selected={draft.city === city.name}
                onPick={() => update({ city: city.name })}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Renders nothing where this deployment has no browser Maps key — a map
          is the only way to place a pin, so the honest answer is no pin section
          rather than Google's "didn't load correctly" watermark. */}
      <PinPicker
        venue={draft.venue}
        city={draft.city}
        latitude={draft.latitude}
        longitude={draft.longitude}
        onPick={(pin) =>
          update({
            latitude: pin.latitude,
            longitude: pin.longitude,
            // A hand-placed pin is nobody's place id — see the invariant above.
            placeId: '',
            // The reverse geocode's city fills a BLANK field and never
            // overwrites one: it is what Google calls the area around the pin,
            // which for an event on the edge of a metro is often the suburb
            // rather than the city people search for.
            city: draft.city.trim() ? draft.city : pin.city.slice(0, CITY_MAX),
          })
        }
        onClear={() => update({ placeId: '', latitude: null, longitude: null })}
      />

      {/* The outbound link stays, next to a map rather than instead of one. It
          answers a different question — it opens in the organizer's own Maps,
          with street view and the surrounding roads — and it is the ONLY check
          available where the browser key is absent and the pin map above
          rendered nothing.

          `directionsUrl` rather than a hand-built query: once there is a pin it
          links the COORDINATES, so the link opens the exact spot being saved
          rather than a search for a name Google may resolve elsewhere. */}
      {mapsQuery ? (
        <Button
          variant="outline"
          size="sm"
          asChild
          className="w-fit max-w-full justify-start overflow-hidden"
        >
          <a
            href={directionsUrl(draft.venue, draft.city, pin)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {pin ? 'Open the pin in Maps' : `Open “${mapsQuery}” in Maps`}
            </span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
        </Button>
      ) : null}

    </div>
  );
}

/**
 * The browse category.
 *
 * ── TILES, NOT A SELECT ───────────────────────────────────────────────────
 *
 * Eight options, each of which already has a drawn scene the visitor will see
 * on the browse page. Showing the organiser the SAME picture their event will
 * sit under is what makes the choice concrete — a dropdown reading "Nightlife"
 * is a word, and the tile is where the event actually ends up.
 *
 * ── "NONE OF THESE" IS AN OPTION, AND IT IS NOT A NINTH CATEGORY ──────────
 *
 * Blank means uncategorised, which is a real state rather than an omission: an
 * event that is genuinely none of the eight should not be filed under the
 * least-wrong one, because browse would then show it to people who asked for
 * something else. It sits apart from the grid for that reason.
 */
function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-stack">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATEGORIES.map((category) => {
          const selected = value === category.slug;
          return (
            <button
              key={category.slug}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? '' : category.slug)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-2 text-left',
                'transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                selected
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <span className="h-12 w-full overflow-hidden rounded-lg">
                <CategoryScene slug={category.slug} />
              </span>
              <span className="min-w-0 truncate text-caption font-medium">{category.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange('')}
          className={cn(
            'inline-flex h-control items-center rounded-full border px-4 text-body-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value
              ? 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'border-primary bg-primary-subtle text-primary-subtle-foreground',
          )}
        >
          None of these
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── schedule ───────────────────────────── */

export function ScheduleStep({ draft, update, issues, save }: StepProps) {
  const starts = draft.startsAt ? new Date(draft.startsAt) : null;
  const ends = draft.endsAt ? new Date(draft.endsAt) : null;
  const valid = starts && !Number.isNaN(starts.valueOf());
  const durationHours =
    valid && ends && !Number.isNaN(ends.valueOf()) && ends > starts
      ? Math.round(((ends.getTime() - starts.getTime()) / 3_600_000) * 10) / 10
      : null;

  // `datetime-local`'s own `min`, so the picker greys out the past rather than
  // letting someone choose a date the API will reject.
  const nowLocal = toLocalInput(new Date().toISOString());

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Schedule"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          id="event-starts"
          label="Starts"
          value={draft.startsAt}
          onChange={(startsAt) => update({ startsAt })}
          min={nowLocal}
          error={errorFor(issues, 'startsAt')}
          hint="Has to be in the future."
        />
        <DateField
          id="event-ends"
          label="Ends"
          value={draft.endsAt}
          onChange={(endsAt) => update({ endsAt })}
          min={draft.startsAt || nowLocal}
          error={errorFor(issues, 'endsAt')}
          hint="Optional. Drives the check-in window and the payout date."
        />
      </div>

      {valid ? (
        <div className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
          <p className="text-body-sm font-medium">Timeline</p>
          <ol className="flex flex-col gap-2.5">
            <TimelineRow
              label="Doors and check-in open"
              value={new Date(starts.getTime() - 60 * 60_000).toLocaleString('en-IN', TIME_FORMAT)}
              note="One hour before, from CHECKIN_WINDOW_OPENS_BEFORE_MINUTES"
            />
            <TimelineRow
              label="Event starts"
              value={starts.toLocaleString('en-IN', TIME_FORMAT)}
              emphasis
            />
            {ends && !Number.isNaN(ends.valueOf()) && ends > starts ? (
              <TimelineRow
                label="Event ends"
                value={ends.toLocaleString('en-IN', TIME_FORMAT)}
                note={durationHours ? `${durationHours} hours long` : undefined}
              />
            ) : null}
            <TimelineRow
              label="Payout releases"
              value="After the event ends, plus the refund window"
              note="settlements releases the on-hold transfer then, not before"
            />
          </ol>
        </div>
      ) : null}

      <Section
        title="Sessions"
      >
        {draft.eventId ? (
          <SessionsEditor eventId={draft.eventId} startsAtLocal={draft.startsAt} />
        ) : (
          <NeedsSavedDraft
            title="Sessions unlock once the draft is saved"
            what="Each session sells its own tickets. Add them once the event exists."
            missing={missingForSave(draft)}
            save={save}
          />
        )}
      </Section>

      <Section
        title="Running order"
      >
        {draft.eventId ? (
          <RunningOrder eventId={draft.eventId} startsAtLocal={draft.startsAt} />
        ) : (
          <NeedsSavedDraft
            title="The running order unlocks once the draft is saved"
            what="Add the running order once the event exists. Nothing above is lost in the meantime."
            missing={missingForSave(draft)}
            save={save}
          />
        )}
      </Section>

    </div>
  );
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * A city shortcut.
 *
 * Picked, it wears the warm `--nav-active` pill — the same mark the step rail,
 * the site header and every applied filter in the product use for "this is the
 * current selection". It was a violet-bordered `--secondary` chip, which read
 * as a control asking to be pressed rather than one already answered.
 *
 * `h-control-sm` rather than a hand-picked 32px: 36px is the shared small
 * control rung, so a chip lines up with a small button and an input.
 */
function CityChip({
  name,
  selected,
  onPick,
}: {
  name: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-control-sm items-center rounded-full border px-3 text-label transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
          : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {name}
    </button>
  );
}

function TimelineRow({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <li className="flex gap-3">
      {/* Violet marks the one moment that matters on the line — an accent, not
          an action. Every other dot is a neutral rule. */}
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          emphasis ? 'bg-primary' : 'bg-border-strong',
        )}
        aria-hidden
      />
      <span className="min-w-0">
        <span className={cn('block text-body-sm', emphasis && 'font-medium')}>{label}</span>
        <span className="block text-caption text-muted-foreground">{value}</span>
        {note ? <span className="block text-caption text-muted-foreground">{note}</span> : null}
      </span>
    </li>
  );
}
