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
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import {
  DateField,
  NeedsSavedDraft,
  NotStored,
  Section,
  SelectField,
  StepHeader,
  TextArea,
  TextField,
  type DraftSave,
} from './fields';
import { missingForSave } from './details-step';
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
        blurb="The title is the single thing that decides whether someone opens your event. Everything else can be edited later."
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
        hint="Include the artist or headline act — it is what people search for."
        autoFocus
      />

      <TextArea
        id="event-description"
        label="Description"
        value={draft.description}
        onChange={(description) => update({ description })}
        placeholder="What happens, who is playing, what is included, and anything an attendee needs to know before buying."
        softMax={DESCRIPTION_SOFT_MAX}
        hint="Shown on the event page and in link previews. Plain text."
      />

      <NotStored>
        A short summary, category, tags, language and age restriction are not collected here because{' '}
        <code>Event</code> has no columns for them — the model is title, description, venue, city
        and dates. Category is the one worth adding first: it would make the browse filters exact
        instead of inferred from wording. BACKLOG items 2 and 28.
      </NotStored>
    </div>
  );
}

/* ──────────────────────────────── venue ─────────────────────────────── */

export function VenueStep({ draft, update, issues }: StepProps) {
  const mapsQuery = [draft.venue, draft.city].filter(Boolean).join(', ');

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Venue"
        blurb="Where it happens. The city drives the browse filters and the “near you” rail, so it has to match how people write it."
      />

      <TextField
        id="event-venue"
        label="Venue"
        value={draft.venue}
        onChange={(venue) => update({ venue })}
        placeholder="Phoenix Marketcity, Kurla"
        max={VENUE_MAX}
        error={errorFor(issues, 'venue')}
        hint="The building or ground, as an attendee would say it."
      />

      <div className="flex flex-col gap-1.5">
        <TextField
          id="event-city"
          label="City"
          value={draft.city}
          onChange={(city) => update({ city })}
          placeholder="Mumbai"
          max={CITY_MAX}
          error={errorFor(issues, 'city')}
          hint="Match one of the cities below and your event appears in that city's landing page."
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

      {/* An OUTBOUND link, not an embedded map. Embedding Google Maps means an
          API key, a third-party script on an authenticated page, and a
          geocoding call per keystroke — for a preview of a string the backend
          stores verbatim and never geocodes. The link answers the same
          question ("is this the right place?") for nothing. */}
      <div className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
        <p className="flex items-center gap-2 text-body-sm font-medium">
          <MapPin className="size-4 text-primary" aria-hidden />
          Check the location
        </p>
        {mapsQuery ? (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="w-fit max-w-full justify-start overflow-hidden"
          >
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="truncate">Open “{mapsQuery}” in Maps</span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </Button>
        ) : (
          <p className="text-caption text-muted-foreground">
            Enter a venue and city to check it on a map.
          </p>
        )}
      </div>

      <NotStored>
        Street address, state, country, pin code, coordinates and venue capacity are not collected:{' '}
        <code>Event</code> stores <code>venue</code> and <code>city</code> as plain strings and
        nothing else. A structured address is a <code>venues</code> module — which is also what
        would make distance-based search and an embedded map possible. BACKLOG items 9 and 28.
      </NotStored>
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
        blurb="When it starts, and when it ends. Times are in your device's timezone — the same clock an attendee in the same city reads."
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
        title="Running order"
        blurb="Doors, support, headline, curfew — the second thing people look for after the price."
      >
        {draft.eventId ? (
          <RunningOrder eventId={draft.eventId} startsAtLocal={draft.startsAt} />
        ) : (
          <NeedsSavedDraft
            title="The running order unlocks once the draft is saved"
            what="Each entry is stored against the event, so it has to exist first. Nothing above is lost in the meantime — it is all held on this device."
            missing={missingForSave(draft)}
            save={save}
          />
        )}
      </Section>

      <NotStored>
        Timezone, a separate doors-open field on the event itself, and recurring events are not
        offered because the backend has no columns for them: <code>Event</code> stores{' '}
        <code>starts_at</code> and <code>ends_at</code> as instants, and recurrence would need a
        whole series model. The doors line above is derived from the real check-in window setting,
        not invented — and a doors entry in the running order is stored for real.
      </NotStored>
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
