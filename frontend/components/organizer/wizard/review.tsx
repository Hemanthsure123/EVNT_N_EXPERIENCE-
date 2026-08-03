'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, Check, Rocket } from 'lucide-react';
import { formatMoney } from '@/lib/discovery/format';
import { describePublishFailure } from '@/lib/organizer/publish-error';
import {
  UNSAVED_DRAFT_BLOCKER,
  priceSummary,
  publishBlockers,
  type Draft,
  type Issue,
  type StepId,
} from '@/lib/organizer/wizard/model';
import type { SaveState } from '@/lib/organizer/wizard/use-wizard';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { missingForSave } from './details-step';

/**
 * Review and publish.
 *
 * THE CHECKLIST IS THE REAL GATE, mirrored. `apps/events/publish_checks.py`
 * runs a registered list before draft→live and `ticketing` registers "has at
 * least one ticket type"; the client shows the same conditions so the button
 * can explain itself rather than failing. The server still decides — if a
 * check is added there and not here, publish is refused and the message says
 * which one.
 *
 * PUBLISHING IS NOT OPTIMISTIC, deliberately, and this is the one place in the
 * dashboard where that is the right call. Everywhere else an optimistic update
 * that turns out wrong costs a repaint. Here it would tell an organizer their
 * event is on sale when it is not — and they would go and tell their audience.
 * The button waits for the 200.
 *
 * THIS IS THE ONE STEP WITH NO "NEXT", which is what frees the near-black pill
 * for Submit. Everywhere else in the Studio that fill belongs to the footer's
 * forward action; here Submit IS the forward action, and it is the only filled
 * control on the screen. Disabled, it stays a pill rather than becoming a grey
 * slab — the shape is how somebody finds it again once the blockers clear.
 */
export function ReviewStep({
  draft,
  issues,
  onJump,
  onPublish,
  publishing,
  publishError,
  organizationName,
  organizations,
  saveState,
  saveError,
  onSaveNow,
}: {
  draft: Draft;
  issues: Issue[];
  onJump: (step: StepId) => void;
  onPublish: () => void;
  publishing: boolean;
  /** The THROWN error, not a string — `describePublishFailure` reads the
   *  machine `code` and `details` the backend sends, which a pre-flattened
   *  message has already thrown away. */
  publishError: unknown;
  organizationName: string;
  /** Carries `verified_level`, which the server gates on BEFORE any readiness
   *  check. Without it this screen can turn every row green and still be
   *  refused. */
  organizations?: readonly { id: string; name: string; verified_level: string }[];
  /** The save engine's live state and message — what the toolbar badge shows,
   *  repeated here so the unsaved blocker carries its CAUSE. */
  saveState: SaveState;
  saveError: string | null;
  /** Flushes the autosave immediately — the way out of "unsaved" that does not
   *  require going back and making an edit. */
  onSaveNow: () => void;
}) {
  const blockers = publishBlockers(draft, organizations);
  const publishFailure = publishError ? describePublishFailure(publishError) : null;
  const organization = organizations?.find((entry) => entry.id === draft.organizationId);
  const verified = !organization || organization.verified_level === 'verified';
  const summary = priceSummary(draft.tiers);
  const ready = blockers.length === 0 && issues.length === 0;

  /**
   * WHY the draft has not saved. The blocker above states the fact; this is
   * the cause, and it used to exist only as a truncated toolbar caption this
   * screen never repeated — so "has not been saved yet" was a dead end:
   * Submit disabled BY the blocker, and nothing anywhere saying what to fix.
   * Ordered by usefulness: the server's actual refusal, then offline, then
   * the field `canCreate` is waiting on.
   */
  const missing = missingForSave(draft);
  const creatable = missing.length === 0;
  const saveCause = draft.eventId
    ? null
    : saveState === 'error'
      ? (saveError ?? 'The last save failed.')
      : saveState === 'offline'
        ? (saveError ?? 'You are offline — the draft saves itself when the connection returns.')
        : !creatable
          ? `Still needed before it can save: ${missing
              .map((item) => item.charAt(0).toLowerCase() + item.slice(1))
              .join(', ')}.`
          : saveState === 'saving'
            ? 'Saving now…'
            : null;

  /**
   * Two lists, not one.
   *
   * Only the first four actually gate a publish — they are what `POST /events`
   * and the registered publish checks require. The rest are worth doing and
   * nothing more, so they are labelled "optional" rather than sitting
   * unchecked next to the real blockers. A checklist that treats an SEO
   * description as equal to a ticket type is a checklist people stop reading.
   */
  const checklist: { label: string; done: boolean; step: StepId; optional?: boolean }[] = [
    // First, because the server checks it first and because it is the only row
    // here the organizer cannot fix on this screen. Finding out about it after
    // eight completed steps is the single worst ordering.
    { label: `${organizationName} is verified`, done: verified, step: 'basics' },
    { label: 'Title', done: Boolean(draft.title.trim()), step: 'basics' },
    {
      label: 'Venue and city',
      done: Boolean(draft.venue.trim() && draft.city.trim()),
      step: 'venue',
    },
    { label: 'Start time in the future', done: Boolean(draft.startsAt), step: 'schedule' },
    { label: 'At least one ticket type', done: draft.tiers.length > 0, step: 'tickets' },
    {
      label: 'Description',
      done: Boolean(draft.description.trim()),
      step: 'basics',
      optional: true,
    },
    { label: 'Cover image', done: Boolean(draft.posterUrl), step: 'media', optional: true },
    {
      label: 'Duration, age policy and access notes',
      done: Boolean(
        draft.durationMinutes || draft.ageRestriction.trim() || draft.accessibilityNotes.trim(),
      ),
      step: 'details',
      optional: true,
    },
    {
      label: 'Search and share copy',
      done: Boolean(draft.seoTitle.trim() || draft.seoDescription.trim()),
      step: 'seo',
      optional: true,
    },
  ];

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-h3">Review and publish</h1>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Publishing makes the event visible on the public site and opens ticket sales. You can keep
          editing afterwards.
        </p>
      </header>

      <section className="flex flex-col gap-stack">
        <h2 className="text-body-sm font-semibold">Checklist</h2>
        {/* Dense rows on purpose: this is a list to run down, not a set of
            cards to admire. Every row is one tap target tall and jumps to the
            step that fixes it. */}
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {checklist.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => onJump(item.step)}
                className="flex min-h-control w-full items-center gap-3 px-card py-2.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
                    item.done ? 'bg-success text-success-foreground' : 'border border-border-strong',
                  )}
                  aria-hidden
                >
                  {item.done ? <Check className="size-3" /> : null}
                </span>
                <span className="flex-1 text-body-sm">
                  {item.label}
                  {item.optional ? (
                    <span className="ml-1.5 text-caption text-muted-foreground">optional</span>
                  ) : null}
                </span>
                <span className="text-caption text-muted-foreground">
                  {item.done ? 'Done' : 'Add'}
                </span>
                <ChevronRight className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted-foreground">
          Only a title, venue, city, future start time and one ticket type are required. A cover
          image is optional but strongly recommended.
        </p>
      </section>

      {issues.length ? (
        <section className="flex flex-col gap-stack" aria-label="Problems to fix">
          <h2 className="flex items-center gap-2 text-body-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            {issues.length} thing{issues.length === 1 ? '' : 's'} to fix
          </h2>
          <ul className="flex flex-col gap-1.5">
            {issues.map((issue) => (
              <li key={`${issue.step}-${issue.field}-${issue.message}`}>
                {/* The border was the same token as the fill, so the row had no
                    edge at all. A tinted row on a white page needs one. */}
                <button
                  type="button"
                  onClick={() => onJump(issue.step)}
                  className="flex min-h-control w-full items-center gap-2 rounded-xl border border-destructive/30 bg-destructive-subtle px-card py-2 text-left text-body-sm text-destructive-subtle-foreground transition-colors duration-fast hover:border-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="min-w-0 flex-1">
                    {issue.message}
                    <span className="ml-1 text-caption">— go to {issue.step}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
        <h2 className="text-body-sm font-semibold">Summary</h2>
        <dl className="grid grid-cols-2 gap-stack sm:grid-cols-3">
          <Cell label="Organisation" value={organizationName || '—'} />
          <Cell label="Ticket types" value={String(draft.tiers.length)} numeric />
          <Cell label="Capacity" value={String(summary.capacity)} numeric />
          <Cell
            label="Price range"
            numeric
            value={
              summary.lowestMinor === null
                ? '—'
                : summary.lowestMinor === summary.highestMinor
                  ? formatMoney(summary.lowestMinor)
                  : `${formatMoney(summary.lowestMinor)} – ${formatMoney(summary.highestMinor ?? 0)}`
            }
          />
          <Cell label="Revenue potential" value={formatMoney(summary.potentialMinor)} numeric />
          <Cell
            label="Visibility"
            value="Public once published"
            note="Every live event is publicly listed; there is no unlisted mode."
          />
        </dl>
      </section>

      {blockers.length ? (
        <ul className="flex flex-col gap-1.5" aria-label="Publish is blocked">
          {blockers.map((blocker) => (
            <li
              key={blocker}
              className="rounded-xl border border-warning/40 bg-warning-subtle px-card py-2 text-body-sm text-warning-subtle-foreground"
            >
              {blocker}
              {/* The unsaved blocker never renders alone when the cause is
                  known — the fact without the cause is the catch-22 this
                  screen used to be. `Save now` appears once the draft is
                  actually creatable, because a button that would early-return
                  on `canCreate` is a lie with a label. */}
              {blocker === UNSAVED_DRAFT_BLOCKER && (saveCause || creatable) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-stack">
                  {saveCause ? <p className="min-w-0 flex-1 text-caption">{saveCause}</p> : null}
                  {creatable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onSaveNow}
                      loading={saveState === 'saving'}
                    >
                      Save now
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* A refused publish, with somewhere to go.
          It used to be `error.message` as terminal red text — a true sentence
          and a dead end, on the screen where somebody has just spent twenty
          minutes. `describePublishFailure` reads the machine `code` the backend
          has always sent and turns each into a destination: the verification
          page, or the step that fixes the check. A pending review is drawn as a
          warning rather than an error, because waiting on an operator is not a
          mistake the organizer made. */}
      {publishFailure ? (
        <div
          role="alert"
          className={cn(
            'flex flex-wrap items-center gap-stack rounded-xl border px-card py-stack text-body-sm',
            publishFailure.tone === 'warning'
              ? 'border-warning/40 bg-warning-subtle text-warning-subtle-foreground'
              : 'border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground',
          )}
        >
          <span className="min-w-0 flex-1">{publishFailure.message}</span>
          {publishFailure.action?.href ? (
            <Link
              href={publishFailure.action.href || '#'}
              onClick={
                publishFailure.action.href === ''
                  ? (moment) => {
                      moment.preventDefault();
                      window.location.reload();
                    }
                  : undefined
              }
              className="shrink-0 rounded-full border border-current px-pill-sm py-1 text-label underline-offset-2 hover:underline"
            >
              {publishFailure.action.label}
            </Link>
          ) : publishFailure.action?.step ? (
            <button
              type="button"
              onClick={() => onJump(publishFailure.action!.step!)}
              className="shrink-0 rounded-full border border-current px-pill-sm py-1 text-label underline-offset-2 hover:underline"
            >
              {publishFailure.action.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-stack">
        {/* `disabled` is passed explicitly rather than left to `loading`:
            Button resolves `disabled ?? loading`, so an explicit `false` would
            WIN over a true `loading` and leave the button pressable mid-submit
            — a second POST on the publish path. */}
        <Button
          size="lg"
          onClick={onPublish}
          disabled={!ready || publishing}
          loading={publishing}
          leftIcon={<Rocket className="size-4" aria-hidden />}
        >
          {publishing ? 'Submitting…' : 'Submit for approval'}
        </Button>
        <p className="text-caption text-muted-foreground">
          {draft.eventId
            ? 'Your draft is already saved. Submitting only puts it in the review queue.'
            : 'Fill in the required fields and the draft saves itself.'}
        </p>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  note,
  numeric,
}: {
  label: string;
  value: string;
  note?: string;
  /** Money and counts get fixed-width figures, so a column of them lines up. */
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-body-sm', numeric && 'tabular-nums')}>{value}</dd>
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}
