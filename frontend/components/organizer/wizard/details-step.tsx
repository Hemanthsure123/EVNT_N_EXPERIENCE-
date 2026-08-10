'use client';

import * as React from 'react';
import {
  ACCESSIBILITY_MAX,
  AGE_RESTRICTION_MAX,
  DURATION_MAX_MINUTES,
  LANGUAGE_MAX,
  SHORT_DESCRIPTION_MAX,
  type Draft,
  type Issue,
} from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';
import { PolicyEditor } from './policy-editor';
import { FaqBuilder } from './faq-builder';
import {
  NeedsSavedDraft,
  Section,
  StepHeader,
  TextArea,
  TextField,
  type DraftSave,
} from './fields';

/**
 * Duration, language, age policy, access notes and FAQs.
 *
 * ── EVERY FIELD HERE IS OPTIONAL, ON PURPOSE ──────────────────────────────
 *
 * Each one maps to a column that is blank by default, and the event page omits
 * the row when it is blank. That is the whole reason to make them optional: a
 * required age field is how "All ages" ends up on an 18+ event, and a required
 * accessibility field is how "Step-free access" ends up on a venue with
 * stairs. Silence is honest; a default is a claim.
 *
 * ── THE PRESETS FILL, THEY DO NOT DECIDE ──────────────────────────────────
 *
 * The duration and age chips are shortcuts for the common answers and nothing
 * more — every one lands in the same editable field, and none is pre-selected.
 * A picked chip wears the warm `--nav-active` pill, the product's one mark for
 * "this is the current selection"; pressing it again clears the field, which is
 * why it is a toggle rather than a button that only ever sets.
 */

type Props = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  issues: Issue[];
  /** The save engine's health, for the FAQ panel's honest closing line. */
  save?: DraftSave;
};

const errorFor = (issues: Issue[], field: string) =>
  issues.find((issue) => issue.field === field)?.message;

const DURATION_PRESETS = [
  { label: '1 hour', minutes: 60 },
  { label: '90 minutes', minutes: 90 },
  { label: '2 hours', minutes: 120 },
  { label: '3 hours', minutes: 180 },
  { label: '4 hours', minutes: 240 },
  { label: 'All day', minutes: 480 },
];

const AGE_PRESETS = ['All ages', 'Under 18s with an adult', '16+', '18+', '21+'];

const LANGUAGE_PRESETS = ['English', 'Hindi', 'Hindi, English', 'Marathi', 'Tamil', 'Telugu'];

export function DetailsStep({ draft, update, issues, save }: Props) {
  const minutes = Number(draft.durationMinutes);
  const readable =
    Number.isInteger(minutes) && minutes > 0 && minutes <= DURATION_MAX_MINUTES
      ? formatMinutes(minutes)
      : null;

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Details"
        blurb="The practical questions people ask before they buy. Anything left blank is omitted from the event page."
      />

      <TextField
        id="event-short-description"
        label="One-line summary"
        value={draft.shortDescription}
        onChange={(shortDescription) => update({ shortDescription })}
        placeholder="Four stages, twelve artists, one night on the Mumbai waterfront."
        max={SHORT_DESCRIPTION_MAX}
        error={errorFor(issues, 'shortDescription')}
        hint="Used in search results and link previews when you have not written separate SEO copy."
      />

      <div className="flex flex-col gap-1.5">
        <TextField
          id="event-duration"
          label="How long it runs"
          value={draft.durationMinutes}
          onChange={(value) => update({ durationMinutes: value.replace(/[^0-9]/g, '') })}
          placeholder="Minutes, e.g. 180"
          error={errorFor(issues, 'durationMinutes')}
          hint={
            readable
              ? `Shown as “${readable}”. Separate from the end time — a festival runs 8 hours over a 2-day window.`
              : 'In minutes. Separate from the end time, which is what the payout and check-in windows use.'
          }
        />
        <Chips
          label="Common durations"
          options={DURATION_PRESETS.map((preset) => ({
            key: preset.label,
            value: String(preset.minutes),
          }))}
          current={draft.durationMinutes}
          onPick={(durationMinutes) => update({ durationMinutes })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <TextField
          id="event-language"
          label="Language"
          value={draft.language}
          onChange={(language) => update({ language })}
          placeholder="Hindi, English"
          max={LANGUAGE_MAX}
          error={errorFor(issues, 'language')}
          hint="Only worth filling in when it decides whether someone can follow along."
        />
        <Chips
          label="Common languages"
          options={LANGUAGE_PRESETS.map((value) => ({ key: value, value }))}
          current={draft.language}
          onPick={(language) => update({ language })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <TextField
          id="event-age"
          label="Age restriction"
          value={draft.ageRestriction}
          onChange={(ageRestriction) => update({ ageRestriction })}
          placeholder="18+"
          max={AGE_RESTRICTION_MAX}
          error={errorFor(issues, 'ageRestriction')}
          hint="Shown on the event page. Leave blank if you have no age policy."
        />
        <Chips
          label="Common policies"
          options={AGE_PRESETS.map((value) => ({ key: value, value }))}
          current={draft.ageRestriction}
          onPick={(ageRestriction) => update({ ageRestriction })}
        />
      </div>

      <TextArea
        id="event-accessibility"
        label="Accessibility"
        value={draft.accessibilityNotes}
        onChange={(accessibilityNotes) => update({ accessibilityNotes })}
        placeholder="Step-free access from Gate 2. Accessible viewing platform beside the sound desk. Assistance dogs welcome. Accessible toilets on the concourse."
        rows={4}
        error={errorFor(issues, 'accessibilityNotes')}
        hint={`What is genuinely available, in your own words — up to ${ACCESSIBILITY_MAX} characters. Someone is deciding whether they can attend at all, so an honest “no step-free access” is far more use than silence.`}
      />

      <Section
        title="Event policies"
        blurb="Your own rules — entry, prohibited items, refunds."
      >
        {/* LOCAL, unlike the FAQs below: `policies` is a column on the event
            written by the same PATCH as everything else on this step, so it
            saves before the draft exists on the server and needs no
            "unlocks once saved" panel. */}
        <PolicyEditor policies={draft.policies} onChange={(policies) => update({ policies })} />
      </Section>

      <Section
        title="Frequently asked questions"
        blurb="Answered here, not in your inbox on the day."
      >
        {draft.eventId ? (
          <FaqBuilder eventId={draft.eventId} />
        ) : (
          <NeedsSavedDraft
            title="FAQs unlock once the draft is saved"
            what="Add these once the event exists. Fill in the fields below and the draft saves itself."
            missing={missingForSave(draft)}
            save={save}
          />
        )}
      </Section>

    </div>
  );
}

function Chips({
  label,
  options,
  current,
  onPick,
}: {
  label: string;
  options: Array<{ key: string; value: string }>;
  current: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="sr-only">{label}</span>
      {options.map((option) => {
        const active = current === option.value;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onPick(active ? '' : option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-control-sm items-center rounded-full border px-3 text-label transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              active
                ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.key}
          </button>
        );
      })}
    </div>
  );
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/** Exactly the fields `POST /events` needs — the same list `canCreate` checks. */
export function missingForSave(draft: Draft): string[] {
  const missing: string[] = [];
  // First, matching `canCreate`. This list used to omit it, so on an account
  // with several organisations it could read "nothing missing" while every
  // flush early-returned on exactly this — the panel promising a save the
  // engine had already refused.
  //
  // ── EACH ITEM NAMES ITS STEP ─────────────────────────────────────────
  //
  // The panel that renders this sits on Media or Details, and the fields are
  // all on Basics, Venue or Schedule. A bare list ("A title", "A venue") tells
  // somebody what is wrong and not where to go — which reads, from a step
  // whose uploader is greyed out, as the uploader being broken rather than as
  // three fields waiting two steps back.
  if (!draft.organizationId) missing.push('Which organisation is running it — on Basics');
  if (!draft.title.trim()) missing.push('A title — on Basics');
  if (!draft.venue.trim()) missing.push('A venue — on Venue');
  if (!draft.city.trim()) missing.push('A city — on Venue');
  if (!draft.startsAt || new Date(draft.startsAt) <= new Date()) {
    missing.push('A start date in the future — on Schedule');
  }
  return missing;
}
