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
import { toIso } from '@/lib/organizer/wizard/model';

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

export function RunningOrder({ eventId, startsAtLocal }: { eventId: string; startsAtLocal: string }) {
  const client = useQueryClient();
  const [kind, setKind] = React.useState<TimelineKind>('doors');
  const [label, setLabel] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);

  const content = useQuery({
    queryKey: ['event-content', eventId],
    queryFn: () => fetchEventContent(eventId),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['event-content', eventId] });

  const create = useMutation({
    mutationFn: (input: Omit<EventTimelineEntry, 'id'>) => addTimelineEntry(eventId, input),
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
    mutationFn: (entryId: string) => removeTimelineEntry(eventId, entryId),
    onSuccess: () => void invalidate(),
  });

  const timeline = content.data?.timeline ?? [];

  const submit = () => {
    if (!label.trim() || create.isPending) return;
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
      {content.isError ? (
        <ErrorState
          message="Could not load the running order."
          onRetry={() => void content.refetch()}
        />
      ) : content.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : timeline.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No running order yet"
          body="Doors, support, headline, curfew."
        />
      ) : (
        <ol className="flex flex-col">
          {timeline.map((entry, index) => (
            <li key={entry.id} className="flex gap-3">
              <span className="flex flex-col items-center" aria-hidden>
                <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                {index < timeline.length - 1 ? (
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
                    {entry.starts_at
                      ? new Date(entry.starts_at).toLocaleString('en-IN', TIME_FORMAT)
                      : 'Time to be confirmed'}
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
                  onClick={() => drop.mutate(entry.id)}
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeline-kind" className="text-body-sm font-medium">
              Kind
            </label>
            <select
              id="timeline-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as TimelineKind)}
              className="h-control rounded-md border border-input bg-surface px-2.5 text-body text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeline-label" className="text-body-sm font-medium">
              What happens
            </label>
            <Input
              id="timeline-label"
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Martin Garrix"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="timeline-time" className="text-body-sm font-medium">
            Time <span className="font-normal text-muted-foreground">— optional</span>
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
          <p className="text-caption text-muted-foreground">
            Leave blank if you know the order but not the times — those entries sit at the
            end.
          </p>
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
            placeholder="Main stage. 90-minute set."
          />
        </div>

        {failure ? (
          <p role="alert" className="text-caption text-destructive">
            {failure}
          </p>
        ) : null}

        <Button
          variant="outline"
          onClick={submit}
          disabled={!label.trim() || create.isPending}
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
