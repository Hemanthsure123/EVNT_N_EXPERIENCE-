'use client';

import * as React from 'react';
import { CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import {
  DESCRIPTION_SOFT_MAX,
  CITY_MAX,
  TITLE_MAX,
  VENUE_MAX,
  dayPart,
  isDraftUntouched,
  joinDateTime,
  spansMultipleDays,
  timePart,
  toLocalInput,
  type Draft,
  type Issue,
} from '@/lib/organizer/wizard/model';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { directionsUrl } from '@/lib/api/maps';
import { createOrganizerCategory } from '@/lib/api/categories';
import { errorMessage } from '@/lib/api/errors';
import { Button, Input, Label, SegmentedControl } from '@/components/ui';
import { PinPicker } from '@/components/maps/pin-picker';
import { VenueAutocomplete, type VenueSelection } from '@/components/maps/venue-autocomplete';
import { cn } from '@/lib/utils/cn';
import {
  DateField,
  DateTimeField,
  TimeOnlyField,
  FieldFrame,
  FieldGroup,
  Section,
  SelectField,
  StepHeader,
  TextArea,
  TextField,
  fieldMessageId,
  type DraftSave,
} from './fields';
import { DescriptionExample } from './description-example';
import { CATEGORIES } from '@/lib/discovery/categories';
import { CategoryScene } from '@/components/illustrations/category-scenes';
import { SessionsEditor } from '@/components/organizer/wizard/sessions-editor';
import { CrewPicker } from './crew-picker';
import { StartFromEvent } from './start-from-event';
import { EVENT_TYPES } from '@/lib/events/taxonomy';
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

      {/* The offer to copy, made where the retyping is about to happen — and
          only while there is nothing to lose. `isDraftUntouched` is false the
          moment a title is typed or the draft reaches the server, so this can
          never sit above work in progress inviting somebody to discard it. */}
      {isDraftUntouched(draft) ? <StartFromEvent /> : null}

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

      {/* `softMax` and not `max`, and the difference matters here more than
          anywhere else on the form: the server's `description` field has no
          `max_length`, and this number came DOWN from 2000, so drafts already
          exist between the two. Enforcing it would block or truncate a
          description the API accepts and the organiser can see on screen. It
          warns; `overHint` is what it says. */}
      <TextArea
        id="event-description"
        label="Description"
        value={draft.description}
        onChange={(description) => update({ description })}
        placeholder="What happens, who is playing, what is included, and anything an attendee needs to know before buying."
        softMax={DESCRIPTION_SOFT_MAX}
        overHint={`Past ${DESCRIPTION_SOFT_MAX} characters people stop reading — but this saves and publishes exactly as written.`}
        action={
          <DescriptionExample
            value={draft.description}
            onInsert={(description) => update({ description })}
          />
        }
      />

      <Section
        title="Category"
      >
        <CategoryPicker
          value={draft.category}
          onChange={(category) => update({ category })}
          organizationId={draft.organizationId}
          customLabel={draft.customCategoryLabel}
          onCustom={(customCategoryId, customCategoryLabel) =>
            update({ customCategoryId, customCategoryLabel })
          }
        />

        {/* ── THE SUB-CLASSIFICATION, BENEATH THE TILE IT REFINES ──────────
            Inside the same section rather than beside it, because it is not a
            second question — it is the same one asked more precisely. "Music
            & dance" covers a club night, an open mic and a classical recital,
            and somebody looking for one is not served by the other two.

            A plain select and not a second scene grid: forty-eight options
            drawn as artwork would out-shout the eight that decide which
            landing page the event lives on. */}
        <div className="mt-stack">
          <SelectField
            id="event-type"
            label="More specifically"
            value={draft.eventType}
            onChange={(eventType) => update({ eventType })}
            options={EVENT_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            /* "Not sure yet" is a REAL state, distinct from every value in the
               list, and it has to stay reachable — an organiser who picks by
               accident must be able to clear it. The server stores `''` for
               exactly this. */
            placeholder="Not sure yet"
            hint="Optional. It helps people searching for this kind of night find you."
          />
        </div>
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

      {/* WHERE IT HAPPENS: the venue and the city are one question asked in
          two fields, so they share a card. There is no Physical/Virtual toggle
          in the header — the reference has one and this platform has no
          `is_virtual` column, no streaming URL and no online-event read path,
          so the control would set nothing. */}
      <FieldGroup title="Location" icon={<MapPin className="size-4" />}>
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
      </FieldGroup>

      {/* Renders nothing where this deployment has no browser Maps key — a map
          is the only way to place a pin, so the honest answer is no pin section
          rather than Google's "didn't load correctly" watermark.

          NOT wrapped in a `FieldGroup`: it draws its own titled card, and it
          renders NOTHING without a Maps key. A group around it would leave an
          empty titled card promising a map that is never coming. */}
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
  organizationId,
  customLabel,
  onCustom,
}: {
  value: string;
  onChange: (value: string) => void;
  organizationId: string;
  customLabel: string;
  onCustom: (id: string, label: string) => void;
}) {
  /**
   * ── "NONE OF THESE" NOW MEANS SOMETHING ─────────────────────────────────
   *
   * It used to be `aria-pressed={!value}` over `onChange('')` — pressed
   * whenever no tile was chosen, which is the state a fresh draft starts in.
   * So it was highlighted before anybody touched it, pressing it did nothing
   * observable, and there was no way to say what the event actually was.
   *
   * The intent is now EXPLICIT and held here rather than derived from an
   * absence: pressing it opens a field for the organizer's own label. It
   * re-opens on reload when a label is already stored, so the state survives
   * the draft being restored.
   */
  const [choosingOwn, setChoosingOwn] = React.useState(Boolean(customLabel));
  const [text, setText] = React.useState(customLabel);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Keeps the box in step with a draft restored under it, without fighting
    // somebody who is mid-type: only adopts a label that is actually new.
    if (customLabel && customLabel !== text) setText(customLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customLabel]);

  const commit = () => {
    const label = text.trim();
    if (!label || saving || !organizationId) return;
    setSaving(true);
    setFailure(null);
    // Created NOW rather than at save time, so the organizer sees it accepted
    // while they are looking at it. The endpoint is idempotent on the label —
    // typing one they already have returns that row rather than refusing —
    // so pressing this twice is safe and needs no existence check.
    void createOrganizerCategory(organizationId, label)
      .then((saved) => {
        onCustom(saved.id, saved.label);
        setText(saved.label);
      })
      .catch((thrown: Error) => setFailure(errorMessage(thrown)))
      .finally(() => setSaving(false));
  };

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
              onClick={() => {
                onChange(selected ? '' : category.slug);
                // Picking a tile answers the question the custom box was for,
                // so the box closes. The stored row is NOT deleted — it is
                // their vocabulary and they may want it on the next event —
                // it is merely detached from this draft.
                setChoosingOwn(false);
                onCustom('', '');
              }}
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
          aria-expanded={choosingOwn}
          aria-controls="custom-category"
          onClick={() => {
            setChoosingOwn((open) => !open);
            // Clears any tile: "none of these" is the answer, so leaving a
            // scene selected behind an open custom box would say both.
            onChange('');
          }}
          className={cn(
            'inline-flex h-control items-center rounded-full border px-4 text-body-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            choosingOwn
              ? 'border-primary bg-primary-subtle text-primary-subtle-foreground'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          None of these
        </button>
      </div>

      {choosingOwn ? (
        <div id="custom-category" className="flex flex-col gap-2 rounded-xl bg-sunken p-card">
          <Label htmlFor="custom-category-input">Your own category</Label>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id="custom-category-input"
              value={text}
              maxLength={60}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                // The field sits inside the wizard's form, so a bare Enter
                // would submit that instead of adding the category.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit();
                }
              }}
              placeholder="Sufi night"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={commit}
              disabled={!text.trim() || saving || text.trim() === customLabel}
              loading={saving}
            >
              {text.trim() === customLabel && customLabel ? 'Saved' : 'Use this'}
            </Button>
          </div>

          {failure ? (
            <p role="alert" className="text-caption text-muted-foreground">
              {failure}
            </p>
          ) : (
            <p className="text-caption text-muted-foreground">
              {/* Says what it does and does NOT do. Somebody typing here would
                  otherwise reasonably assume they had made a new browse
                  category for the whole platform. */}
              Kept on your organisation and offered on your next event. It is your label — it
              does not add a tile to the public browse pages.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── schedule ───────────────────────────── */

// `save` is no longer destructured: the three sections below used to hand it
// to a `NeedsSavedDraft` panel so the wall could offer a Save button. With the
// wall gone there is nothing on this step that saves on demand — the wizard's
// own autosave and the action bar own that.
export function ScheduleStep({ draft, update, issues }: StepProps) {
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

  // DERIVED from the dates, with a manual override held only in component
  // state. `null` means "nobody has said", so the layout follows the data —
  // which is what makes an event loaded from the server open in the right
  // shape without a stored flag.
  const [multiDayOverride, setMultiDayOverride] = React.useState<boolean | null>(null);
  const multiDay = multiDayOverride ?? spansMultipleDays(draft.startsAt, draft.endsAt);

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Schedule"
      />

      {/* ── ONE DAY OR SEVERAL ────────────────────────────────────────────
          DERIVED, never stored. There is no `multi_day` column and there must
          not be one: the two datetimes already say it, and a flag beside them
          is a second source of truth that can disagree with the dates it
          describes. The override lives in component state, so an organiser who
          has not filled the End field yet can still switch to the multi-day
          layout and get the second date picker.

          Below, single-day asks "which day" ONCE. Asking again in the End
          field is a question whose answer is already known — and can be
          answered wrongly, which is how an event ends the day before it
          starts. */}
      <FieldGroup
        title="Date & schedule"
        icon={<CalendarDays className="size-4" />}
        aside={
          /* ── THE BINARY CHOICE AS A PILL TOGGLE ────────────────────────
             This was a bare checkbox labelled "This event runs across more
             than one day". A checkbox states one option and leaves the other
             implied, so the reader has to invert the sentence to find out what
             unchecking it means — and the two layouts underneath are genuinely
             different forms, not a detail being switched on.

             `SegmentedControl` names both, which is what the control actually
             is: two mutually exclusive shapes for the same question. It is
             also already a proper radiogroup with roving tabindex, so this
             gains arrow-key selection and an announced "1 of 2" that the
             checkbox never had.

             The value is still DERIVED from the two datetimes and still
             overridden in component state — nothing about the storage
             changed, and there is deliberately no `multi_day` column. */
          <SegmentedControl
            aria-label="How many days"
            size="sm"
            value={multiDay ? 'multi' : 'single'}
            onValueChange={(value) => {
              const next = value === 'multi';
              setMultiDayOverride(next);
              // Going to single-day COLLAPSES the end onto the start's date,
              // keeping the time. Clearing it instead would silently drop a
              // check-in window and a payout date the organiser had set;
              // moving it is the reading that loses nothing.
              if (!next && draft.startsAt && draft.endsAt) {
                update({ endsAt: joinDateTime(dayPart(draft.startsAt), timePart(draft.endsAt)) });
              }
            }}
            options={[
              { value: 'single', label: 'One day' },
              { value: 'multi', label: 'Several' },
            ]}
          />
        }
      >
      {multiDay ? (
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
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            id="event-starts"
            label="Starts"
            day={dayPart(draft.startsAt)}
            time={timePart(draft.startsAt)}
            onChange={({ day, time }) => {
              const startsAt = joinDateTime(day, time);
              // The end follows the start's DATE while they are on one day —
              // otherwise moving the event to next week leaves the end behind
              // on the old date and the event finishes before it begins.
              const endsAt = draft.endsAt
                ? joinDateTime(day || dayPart(draft.endsAt), timePart(draft.endsAt))
                : draft.endsAt;
              update({ startsAt, endsAt });
            }}
            min={nowLocal}
            error={errorFor(issues, 'startsAt')}
            hint="Has to be in the future."
            timeLabel="start time"
          />
          <TimeOnlyField
            id="event-ends"
            label="Ends"
            /* The DATE is the start's, always, in this mode. Only the time is
               the organiser's to set — which is the whole point of the split. */
            value={timePart(draft.endsAt)}
            onChange={(time) =>
              update({
                endsAt: time ? joinDateTime(dayPart(draft.startsAt), time) : '',
              })
            }
            error={errorFor(issues, 'endsAt')}
            hint="Optional. Drives the check-in window and the payout date."
          />
        </div>
      )}
      </FieldGroup>

      {valid ? (
        <div className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
          <p className="text-body-sm font-medium">Timeline</p>
          <ol className="flex flex-col gap-2.5">
            <TimelineRow
              label="Doors and check-in open"
              value={new Date(starts.getTime() - 60 * 60_000).toLocaleString('en-IN', TIME_FORMAT)}
              note="One hour before doors"
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
              note="Not before — the money is held until then"
            />
          </ol>
        </div>
      ) : null}

      {/* ── NO LONGER GATED ON A SAVED DRAFT ─────────────────────────────
          These three sections used to render a `NeedsSavedDraft` wall until
          the event existed, because every write in them addresses
          `/events/{id}/...`. That was accurate and it stacked three of them on
          one step, each answering "go back two steps first".

          The dependency is real and has not been wished away: what changed is
          that rows typed before the event exists are STAGED IN THE DRAFT and
          flushed by the save engine the moment it is created. They ride the
          local-first autosave, so a reload keeps them. See `PendingSlot` in
          `model.ts` and the flush in `use-wizard.ts`. */}
      <Section
        title="Sessions"
      >
        <SessionsEditor
          eventId={draft.eventId || null}
          startsAtLocal={draft.startsAt}
          pending={draft.pendingSlots}
          onPending={(pendingSlots) => update({ pendingSlots })}
        />
      </Section>

      <Section
        title="Running order"
      >
        <RunningOrder
          eventId={draft.eventId || null}
          startsAtLocal={draft.startsAt}
          pending={draft.pendingTimeline}
          onPending={(pendingTimeline) => update({ pendingTimeline })}
        />
      </Section>

      {/* A SECTION HERE, NOT A NINTH STEP.
          The running order already lives on this step, and a lineup and a
          running order are the same question asked twice — who is on, and
          when. A ninth step would also break the "Eight steps" promise the
          sidebar and the ⌘K palette make, which `nav.test.ts` pins to
          `STEPS.length`.

          Open from the start, like the two above. The ROSTER never needed an
          event — it hangs off the organization — so the crew list and the add
          form always worked; only the LINEUP needs an id, and that is held in
          the draft until there is one. */}
      <Section title="Who's taking the stage">
        <CrewPicker
          eventId={draft.eventId || null}
          staged={draft.crewIds}
          onStaged={(crewIds) => update({ crewIds })}
        />
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
