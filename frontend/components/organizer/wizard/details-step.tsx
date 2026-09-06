'use client';

import * as React from 'react';
import {
  AGE_RESTRICTION_MAX,
  DURATION_MAX_MINUTES,
  LANGUAGE_MAX,
  SHORT_DESCRIPTION_MAX,
  type Draft,
  type Issue,
} from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';
import { PolicyEditor } from './policy-editor';
import { BulletListEditor } from './bullet-list-editor';
import { TagMatrix } from './tag-matrix';

/** Mirrors the server's `MAX_HIGHLIGHTS`, so the control cannot ask for a save
 *  the boundary would refuse. */
const MAX_HIGHLIGHTS = 8;
import { FaqBuilder } from './faq-builder';
import { QuestionBuilder } from './question-builder';
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
      />

      <TextField
        id="event-short-description"
        label="One-line summary"
        value={draft.shortDescription}
        onChange={(shortDescription) => update({ shortDescription })}
        placeholder="Four stages, twelve artists, one night on the Mumbai waterfront."
        max={SHORT_DESCRIPTION_MAX}
        error={errorFor(issues, 'shortDescription')}
      />

      {/* ── TWO GROUPS, BECAUSE THESE ARE TWO QUESTIONS ────────────────────
          The step was six sibling blocks at one weight: summary, duration,
          language, age, accessibility, policies, FAQs. "How long is it and in
          what language" and "who is allowed in and can they get around" are
          different decisions, often made by different people, and flattening
          them into one column is what made a short step feel long. */}
      <Section title="Running time and language">
        <div className="flex flex-col gap-block sm:flex-row sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <TextField
              id="event-duration"
              label="How long it runs"
              value={draft.durationMinutes}
              onChange={(value) => update({ durationMinutes: value.replace(/[^0-9]/g, '') })}
              placeholder="Minutes, e.g. 180"
              error={errorFor(issues, 'durationMinutes')}
              // Live feedback, not an explanation. The two sentences that used
              // to sit here described what the field was NOT (the end time) —
              // the classic paragraph standing in for a label. The label says
              // "how long it runs", the placeholder says minutes, and this
              // echoes the typed number back in the words the event page will
              // print. Nothing left to explain.
              hint={readable ? `Shown as “${readable}”` : undefined}
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

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <TextField
              id="event-language"
              label="Language"
              value={draft.language}
              onChange={(language) => update({ language })}
              placeholder="Hindi, English"
              max={LANGUAGE_MAX}
              error={errorFor(issues, 'language')}
            />
            <Chips
              label="Common languages"
              options={LANGUAGE_PRESETS.map((value) => ({ key: value, value }))}
              current={draft.language}
              onPick={(language) => update({ language })}
            />
          </div>
        </div>
      </Section>

      <Section title="Who can come, and how they get in">
        <div className="flex flex-col gap-block">
          <div className="flex flex-col gap-1.5">
            <TextField
              id="event-age"
              label="Age restriction"
              value={draft.ageRestriction}
              onChange={(ageRestriction) => update({ ageRestriction })}
              placeholder="18+"
              max={AGE_RESTRICTION_MAX}
              error={errorFor(issues, 'ageRestriction')}
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
          />
        </div>
      </Section>

      {/* ── THE THREE BULLET LISTS ────────────────────────────────────────
          Above the policies rather than below, because they answer the
          questions a buyer has FIRST — what do I get, what am I not getting —
          where a policy is read after deciding. They are also the two lists a
          refund dispute turns on, which is why "not included" is its own list
          rather than a line inside the guidelines. */}
      <Section title="What people get">
        <div className="flex flex-col gap-block">
          <BulletListEditor
            id="event-highlights-included"
            label="What's included"
            hint="What the ticket covers. Materials, refreshments, a take-home piece."
            placeholder="All materials and tools"
            value={draft.highlightsIncluded}
            onChange={(highlightsIncluded) => update({ highlightsIncluded })}
            max={MAX_HIGHLIGHTS}
          />
          <BulletListEditor
            id="event-highlights-excluded"
            label="What's not included"
            hint="Say it here and nobody arrives expecting it. Travel, food, equipment to bring."
            placeholder="Travel to the venue"
            value={draft.highlightsExcluded}
            onChange={(highlightsExcluded) => update({ highlightsExcluded })}
            max={MAX_HIGHLIGHTS}
          />
          <BulletListEditor
            id="event-guidelines"
            label="Guidelines"
            hint="How to turn up: dress code, what to bring, anything the venue asks."
            placeholder="Carry a photo ID"
            value={draft.guidelines}
            onChange={(guidelines) => update({ guidelines })}
            max={MAX_HIGHLIGHTS}
            addLabel="Add guideline"
          />
        </div>
      </Section>

      {/* ── TAGS ──────────────────────────────────────────────────────────
          Here rather than in Basics, beside the category, and the reason is
          what they are FOR. A category is an identity — which tile the event
          belongs under. Tags are how it is FOUND: who it suits, what is
          included, how it feels. That is the same question the rest of this
          step answers (language, age, access), which is why it reads as
          belonging here. */}
      <Section title="Tags">
        <TagMatrix value={draft.tags} onChange={(tags) => update({ tags })} />
      </Section>

      <Section
        title="Event policies"
      >
        {/* LOCAL, unlike the FAQs below: `policies` is a column on the event
            written by the same PATCH as everything else on this step, so it
            saves before the draft exists on the server and needs no
            "unlocks once saved" panel. */}
        <PolicyEditor policies={draft.policies} onChange={(policies) => update({ policies })} />
      </Section>

      <Section
        title="Frequently asked questions"
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

      {/* AFTER the FAQs, because the two are opposites and the order says so:
          an FAQ is what the organiser TELLS a buyer, a question is what they
          ASK them. Gated on a saved draft like every other server-backed
          collection — a question is a row keyed on an event that has to
          exist. */}
      <Section
        title="Questions for attendees"
      >
        {draft.eventId ? (
          <QuestionBuilder eventId={draft.eventId} />
        ) : (
          <NeedsSavedDraft
            title="Questions unlock once the draft is saved"
            what="Ask for anything you need before somebody turns up. Most events ask none."
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
