'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import {
  addSlot,
  fetchOwnerSlots,
  removeSlot,
  updateSlot,
  type EventSlot,
} from '@/lib/api/event-content';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import { toIso } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';

/**
 * Sessions — the showtimes an event runs at.
 *
 * ── ADDING ONE CHANGES WHAT THE TICKETS STEP MEANS ────────────────────────
 *
 * Ticket tiers belong to a session. Inventory lives on the TIER row, so "GA"
 * at 18:00 and "GA" at 21:00 are two rows with two counters — which is the
 * whole reason a session can sell out without touching the next one. The
 * tickets step therefore asks which session each tier sells, and that question
 * only appears once at least one session exists here.
 *
 * ── SWITCH OFF, DO NOT DELETE ─────────────────────────────────────────────
 *
 * A session with tiers attached cannot be deleted — the server refuses with
 * `409 slot_in_use`, because those tiers hold the counters and, after a sale,
 * real issued tickets. So the destructive control is offered ONLY while a
 * session is empty, and "Stop selling" is what a cancelled show actually is.
 * Offering a Delete that 409s would be a button whose job is to fail.
 *
 * ── THE EVENT'S OWN START FOLLOWS THE SESSIONS ────────────────────────────
 *
 * The server re-derives `Event.starts_at` from the earliest active session on
 * every write here, because browse sorts on it, the check-in window opens
 * against it, and settlements decide "finished" from it. The note below says
 * so, because a Schedule step with two start times and no explanation is how
 * an organiser concludes one of them is wrong.
 */

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
};

export function SessionsEditor({
  eventId,
  startsAtLocal,
}: {
  eventId: string;
  startsAtLocal: string;
}) {
  const client = useQueryClient();
  const [label, setLabel] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);

  const slots = useQuery({
    queryKey: ['event-slots', eventId],
    queryFn: () => fetchOwnerSlots(eventId),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ['event-slots', eventId] });
    // The public content payload carries the active sessions, and the tickets
    // step reads the tier list — both go stale the moment a session moves.
    void client.invalidateQueries({ queryKey: ['event-content', eventId] });
    void client.invalidateQueries({ queryKey: ['event-tiers', eventId] });
  };

  const fail = (thrown: unknown, fallback: string) =>
    setFailure(thrown instanceof ApiError ? thrown.message : fallback);

  const create = useMutation({
    mutationFn: (input: { starts_at: string; label: string; ends_at: string | null }) =>
      addSlot(eventId, input),
    onSuccess: () => {
      setLabel('');
      setStartsAt('');
      setEndsAt('');
      setFailure(null);
      invalidate();
    },
    onError: (thrown) => fail(thrown, 'Could not add that session.'),
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; is_active: boolean }) =>
      updateSlot(eventId, input.id, { is_active: input.is_active }),
    onSuccess: () => {
      setFailure(null);
      invalidate();
    },
    onError: (thrown) => fail(thrown, 'Could not update that session.'),
  });

  const drop = useMutation({
    mutationFn: (slotId: string) => removeSlot(eventId, slotId),
    onSuccess: () => {
      setFailure(null);
      invalidate();
    },
    // The server's own message names the reason ("this session still has
    // ticket tiers attached"), which is more use than anything written here.
    onError: (thrown) => fail(thrown, 'Could not remove that session.'),
  });

  const rows = slots.data ?? [];

  const submit = () => {
    if (!startsAt || create.isPending) return;
    create.mutate({
      starts_at: toIso(startsAt),
      label: label.trim(),
      ends_at: endsAt ? toIso(endsAt) : null,
    });
  };

  return (
    <div className="flex flex-col gap-stack-lg">
      {slots.isError ? (
        <ErrorState message="Could not load the sessions." onRetry={() => void slots.refetch()} />
      ) : slots.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="One showing"
          body="Add sessions only if this event runs more than once — a 6pm and a 9pm show, or the same play across a weekend. Each one sells its own tickets, so one can sell out while the next stays open."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((slot) => (
            <SessionRow
              key={slot.id}
              slot={slot}
              busy={toggle.isPending || drop.isPending}
              onToggle={() => toggle.mutate({ id: slot.id, is_active: !slot.is_active })}
              onRemove={() => drop.mutate(slot.id)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-stack rounded-xl border border-border bg-sunken p-card">
        <div className="grid gap-stack-lg sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="session-starts" className="text-body-sm font-medium">
              Starts
            </label>
            <Input
              id="session-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
            {startsAtLocal ? (
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
            <label htmlFor="session-ends" className="text-body-sm font-medium">
              Ends <span className="font-normal text-muted-foreground">— optional</span>
            </label>
            <Input
              id="session-ends"
              type="datetime-local"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(event) => setEndsAt(event.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              Without one, the window closes a grace period after the session starts.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="session-label" className="text-body-sm font-medium">
            Name <span className="font-normal text-muted-foreground">— optional</span>
          </label>
          <Input
            id="session-label"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Matinee"
          />
          <p className="text-caption text-muted-foreground">
            Only needed when two sessions start at once — a main stage and a side stage.
          </p>
        </div>

        {failure ? (
          <p role="alert" className="text-caption text-destructive">
            {failure}
          </p>
        ) : null}

        <Button
          variant="outline"
          onClick={submit}
          disabled={!startsAt || create.isPending}
          loading={create.isPending}
          leftIcon={<Plus className="size-4" aria-hidden />}
          className="w-fit"
        >
          {create.isPending ? 'Adding…' : 'Add a session'}
        </Button>
      </div>

      {rows.length ? (
        <p className="text-caption text-muted-foreground">
          The event&apos;s start time above follows the earliest session still selling.
        </p>
      ) : null}
    </div>
  );
}

function SessionRow({
  slot,
  busy,
  onToggle,
  onRemove,
}: {
  slot: EventSlot;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const when = new Date(slot.starts_at);
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3',
        !slot.is_active && 'opacity-65',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium tabular-nums">
          {Number.isNaN(when.valueOf())
            ? slot.starts_at
            : when.toLocaleString('en-IN', TIME_FORMAT)}
        </span>
        <span className="block text-caption text-muted-foreground">
          {slot.label || 'No name'}
          {slot.is_active ? '' : ' · not selling'}
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={onToggle} disabled={busy} className="shrink-0">
        {slot.is_active ? 'Stop selling' : 'Sell again'}
      </Button>
      {/* Offered only while nothing sells this session. With tiers attached the
          server refuses (409), and a control whose job is to fail is worse than
          no control — "Stop selling" is the operation that always works, and is
          what a cancelled show actually is. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove the ${slot.label || 'session'} at ${slot.starts_at}`}
        className="shrink-0 hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}
