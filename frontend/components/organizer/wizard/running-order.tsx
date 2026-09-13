'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2 } from 'lucide-react';
import {
  addTimelineEntry,
  fetchEventContent,
  removeTimelineEntry,
  type EventTimelineEntry,
  type TimelineKind,
} from '@/lib/api/event-content';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import { tempId, toIso, type PendingTimelineEntry } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';

/**
 * The running order.
 *
 * ── TIMES ARE INSTANTS, WHICH IS WHY MIDNIGHT WORKS ───────────────────────
 *
 * `starts_at` is a full datetime, not a time-of-day. A festival's after-party
 * at 00:30 belongs AFTER the 19:00 doors, and a time-only field sorts it
 * first. The input is therefore `datetime-local` seeded with the event's own
 * date, so the common case is two keystrokes and the midnight case is
 * possible at all.
 *
 * ── A TIME IS OPTIONAL ────────────────────────────────────────────────────
 *
 * An organizer usually knows the running order before the clock times, and a
 * required field is how a made-up time gets published. Entries without one
 * sort last, which the server does by construction.
 *
 * ── NO EDIT, NO DRAG ──────────────────────────────────────────────────────
 *
 * `/events/{id}/timeline` is POST and DELETE. Order comes from `starts_at`
 * then `position`, both set on create — so a correction is remove-then-add,
 * and there is no drag handle pretending to write a field no endpoint accepts.
 *
 * ── THE COMPOSER IS AN `outline` CONTROL, NOT A FILLED ONE ────────────────
 *
 * "Add to the running order" is repeated once per entry; the schedule step's
 * one near-black pill belongs to the wizard footer's Next. Violet survives here
 * as the timeline's own markers and the "use the event start time" link, which
 * is exactly the wayfinding role the accent kept.
 */

const KINDS: Array<{ value: TimelineKind; label: string }> = [
  { value: 'doors', label: 'Doors open' },
  { value: 'opening', label: 'Opening act' },
  { value: 'session', label: 'Session' },
  { value: 'intermission', label: 'Interval' },
  { value: 'main', label: 'Main act' },
  { value: 'after_party', label: 'After party' },
  { value: 'closing', label: 'Closing' },
];

const KIND_LABEL = Object.fromEntries(KINDS.map((kind) => [kind.value, kind.label])) as Record<
  TimelineKind,
  string
>;

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * ── IT WORKS BEFORE THE EVENT EXISTS ──────────────────────────────────────
 *
 * `eventId` is nullable. With no id, entries are STAGED in the wizard draft
 * (`draft.pendingTimeline`) and the save engine POSTs them the moment the
 * event is created; they ride the local-first autosave meanwhile, so a reload
 * does not lose them. See `PendingTimelineEntry` in `model.ts`.
 *
 * Staged and saved entries render in ONE list, in the order they will end up
 * in, because a running order that reordered itself on save would be worse
 * than useless. A staged one is drawn with a hollow marker and says it saves
 * with the draft — the only operation it supports is removal, which is local.
 */
export function RunningOrder({
  eventId,
  organizationId,
  startsAtLocal,
  pending,
  onPending,
}: {
  /** `null` until the draft has been saved — see the note above. */
  eventId: string | null;
  /** Scopes the remembered Kind vocabulary. One promoter's words are not
   *  another's, and neither is public. */
  organizationId: string;
  startsAtLocal: string;
  pending: PendingTimelineEntry[];
  onPending: (next: PendingTimelineEntry[]) => void;
}) {
  const client = useQueryClient();
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);

  /**
   * The organizer's OWN list of kinds, plus the seven built-ins.
   *
   * Per organization and on this device: the server has no column for a
   * per-account vocabulary, and inventing one for a `<datalist>` would be a
   * migration on the events module for an autocomplete. Reading is wrapped
   * because `localStorage` throws in a private window and a suggestion list
   * is not worth a white screen.
   */
  const vocabularyKey = `ee-timeline-kinds::${organizationId || 'default'}`;
  const [remembered, setRemembered] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(vocabularyKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setRemembered(
        Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [],
      );
    } catch {
      setRemembered([]);
    }
  }, [vocabularyKey]);

  const kindOptions = React.useMemo(() => {
    const seen = new Set<string>();
    return [...KINDS.map((option) => option.label), ...remembered].filter((option) => {
      const key = option.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [remembered]);

  /**
   * `EventTimelineEntry.kind` is a closed `TextChoices` on the server, so an
   * unknown string is a 400. What the organizer typed is the LABEL — the text
   * the event page renders — and this only decides which of the seven the row
   * is filed under. `session` is the neutral one.
   */
  const kindFor = (text: string): TimelineKind =>
    KINDS.find((option) => option.label.toLowerCase() === text.trim().toLowerCase())?.value ??
    'session';

  const rememberKind = (text: string) => {
    const value = text.trim();
    if (!value || KINDS.some((option) => option.label.toLowerCase() === value.toLowerCase())) return;
    const next = [...new Set([value, ...remembered])].slice(0, 24);
    setRemembered(next);
    try {
      window.localStorage.setItem(vocabularyKey, JSON.stringify(next));
    } catch {
      // A suggestion list is not worth failing an entry over.
    }
  };

  const content = useQuery({
    queryKey: ['event-content', eventId],
    queryFn: () => fetchEventContent(eventId as string),
    // Nothing to fetch before the event exists. Every read below therefore
    // checks `eventId` rather than `isPending`, which stays true for ever
    // while a query is disabled.
    enabled: Boolean(eventId),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['event-content', eventId] });

  const create = useMutation({
    mutationFn: (input: Omit<EventTimelineEntry, 'id'>) =>
      addTimelineEntry(eventId as string, input),
    onSuccess: () => {
      setLabel('');
      setDescription('');
      setStartsAt('');
      setFailure(null);
      void invalidate();
    },
    onError: (thrown) =>
      setFailure(thrown instanceof ApiError ? thrown.message : 'Could not add that entry.'),
  });

  const drop = useMutation({
    mutationFn: (entryId: string) => removeTimelineEntry(eventId as string, entryId),
    onSuccess: () => void invalidate(),
  });

  const timeline = eventId ? (content.data?.timeline ?? []) : [];

  /**
   * Saved rows then staged rows, as ONE list.
   *
   * Normalised to a common shape so the renderer below draws both without
   * branching per line — the alternative was two nearly identical `map`s and
   * a second copy of the connector-line arithmetic, which is how the two
   * quietly stop matching.
   */
  const entries = [
    ...timeline.map((entry) => ({
      key: entry.id,
      // Typed rather than widened to `string`: `KIND_LABEL` is keyed on the
      // union, so a widened kind loses the lookup and the row would render a
      // raw slug instead of "Doors open".
      kind: entry.kind,
      label: entry.label,
      description: entry.description,
      startsAt: entry.starts_at,
      staged: false,
      remove: () => drop.mutate(entry.id),
    })),
    ...pending.map((entry) => ({
      key: entry.tempId,
      // The draft stores it as a plain string (the model must not import a
      // client type), so it is narrowed back here at the single point where
      // the two shapes meet.
      kind: entry.kind as TimelineKind,
      label: entry.label,
      description: entry.description,
      startsAt: entry.startsAt || null,
      staged: true,
      remove: () => onPending(pending.filter((candidate) => candidate.tempId !== entry.tempId)),
    })),
  ];

  const submit = () => {
    if (!label.trim() || !startsAt || create.isPending) return;
    const kind = kindFor(label);
    rememberKind(label);
    // With an event the entry goes to the server now; without one there is
    // nothing to POST to, so it is staged for the save engine.
    if (!eventId) {
      onPending([
        ...pending,
        { tempId: tempId(), kind, label: label.trim(), description: description.trim(), startsAt },
      ]);
      setLabel('');
      setDescription('');
      setStartsAt('');
      setFailure(null);
      return;
    }
    create.mutate({
      kind,
      label: label.trim(),
      description: description.trim(),
      starts_at: startsAt ? toIso(startsAt) : null,
      position: timeline.length,
    });
  };

  return (
    <div className="flex flex-col gap-stack-lg">
      {eventId && content.isError ? (
        <ErrorState
          message="Could not load the running order."
          onRetry={() => void content.refetch()}
        />
      ) : eventId && content.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No running order yet"
        />
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex gap-3">
              <span className="flex flex-col items-center" aria-hidden>
                <span
                  className={cn(
                    'mt-2 size-2 shrink-0 rounded-full',
                    // Hollow for a staged entry: the marker is the one part of
                    // the row the eye tracks down the list, so it is where the
                    // "not saved yet" state belongs.
                    entry.staged ? 'border border-border-strong bg-surface' : 'bg-primary',
                  )}
                />
                {index < entries.length - 1 ? (
                  <span className="w-px flex-1 bg-border-strong" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 items-start gap-3 pb-stack-lg">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-body-sm font-medium">{entry.label}</span>
                    <span className="text-caption text-muted-foreground">
                      {KIND_LABEL[entry.kind] ?? entry.kind}
                    </span>
                  </span>
                  <span className="block text-caption tabular-nums text-muted-foreground">
                    {entry.startsAt
                      ? new Date(entry.startsAt).toLocaleString('en-IN', TIME_FORMAT)
                      : 'Time to be confirmed'}
                    {entry.staged ? ' · saves with the draft' : ''}
                  </span>
                  {entry.description ? (
                    <span className="block text-caption text-muted-foreground">
                      {entry.description}
                    </span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={entry.remove}
                  disabled={drop.isPending}
                  aria-label={`Remove ${entry.label}`}
                  className="shrink-0 hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-stack rounded-xl border border-border bg-sunken p-card">
        <div className="grid gap-stack-lg sm:grid-cols-[10rem_minmax(0,1fr)]">
          {/* ── KIND IS FREE TEXT, AND IT IS THE ENTRY ────────────────────
              "What happens" is gone at the owner's instruction, so Kind is
              the only text left and therefore has to BE the line the event
              page shows. What is typed is stored as `label`, which is the
              column that renders; the enum `kind` is matched from the seven
              built-ins when the text is one of them and falls back to
              `session` otherwise, because that column is a closed
              `TextChoices` on the server and an unknown value is a 400.

              The `<datalist>` offers the built-ins PLUS everything this
              organization has typed before — remembered per organization on
              this device, which is "organizer specific, not public" as far as
              it can be taken without a backend column to hold a real
              account-level vocabulary. */}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="timeline-kind" className="text-body-sm font-medium">
              Kind
            </label>
            <Input
              id="timeline-kind"
              list="timeline-kind-options"
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
            <datalist id="timeline-kind-options">
              {kindOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="timeline-time" className="text-body-sm font-medium">
            Time
          </label>
          <Input
            id="timeline-time"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          {startsAtLocal ? (
            // A link, and it looks like one: violet is the wayfinding accent
            // and this is the only true link in the composer.
            <button
              type="button"
              onClick={() => setStartsAt(startsAtLocal)}
              className="w-fit rounded-full text-caption text-primary underline underline-offset-2 transition-colors duration-fast hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Use the event start time
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="timeline-note" className="text-body-sm font-medium">
            Note <span className="font-normal text-muted-foreground">— optional</span>
          </label>
          <Input
            id="timeline-note"
            value={description}
            maxLength={300}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {failure ? (
          <p role="alert" className="text-caption text-muted-foreground">
            {failure}
          </p>
        ) : null}

        <Button
          variant="outline"
          onClick={submit}
          disabled={!label.trim() || !startsAt || create.isPending}
          loading={create.isPending}
          leftIcon={<Plus className="size-4" aria-hidden />}
          className="w-fit"
        >
          {create.isPending ? 'Adding…' : 'Add to the running order'}
        </Button>
      </div>
    </div>
  );
}
