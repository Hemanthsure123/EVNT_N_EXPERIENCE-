'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Plus, UserRound } from 'lucide-react';
import { createCrewMember, fetchCrew, fetchEventCrew, setEventCrew } from '@/lib/api/crew';
import { errorMessage } from '@/lib/api/errors';
import { useOrganizations } from '@/lib/identity/scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * Who is taking the stage — the wizard's half of the crew feature.
 *
 * ── IT ONLY CHOOSES. IT NEVER OWNS THE PEOPLE ────────────────────────────
 *
 * The roster lives at /dashboard/crew and is reused across every event; this
 * control picks from it. That split is the whole reason the feature is worth
 * building — a promoter running the same night monthly adds their resident
 * once, not twelve times.
 *
 * ── THE FIRST MULTI-SELECT IN THE CODEBASE, SO IT IS BUILT FROM CHIPS ────
 *
 * There is no multi-select in `components/ui/` — `Combobox` is single-value
 * and the wizard's own pickers are all toggles. Rather than invent a new
 * visual language, this reuses the one mark the product already uses for a
 * chosen value: a filled chip with `aria-pressed`, the same treatment the
 * performer profile editor gives its occasions.
 *
 * ── ORDER IS THE ORGANISER'S, AND IT IS PRESERVED ────────────────────────
 *
 * Selections append in the order they are pressed and that order is what the
 * public page renders. Sorting alphabetically would put the support act above
 * the headliner, which is a claim about the night that nobody made.
 *
 * ── SAVED AS A SET, ON A BUTTON ──────────────────────────────────────────
 *
 * `PUT /events/{id}/crew` replaces the whole lineup. Autosaving every toggle
 * would issue a write per press — and, on a slow connection, let two of them
 * land out of order and settle on a lineup nobody chose. One press, one write.
 */
export function CrewPicker({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const organizations = useOrganizations();
  const organizationId = organizations.data?.data?.[0]?.id ?? null;
  const [error, setError] = React.useState<string | null>(null);

  const roster = useQuery({
    queryKey: ['organizer', 'crew', organizationId, 'active'],
    queryFn: () => fetchCrew(organizationId!, { activeOnly: true }),
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });

  const lineup = useQuery({
    queryKey: ['organizer', 'event-crew', eventId],
    queryFn: () => fetchEventCrew(eventId),
    staleTime: 30_000,
  });

  // Local, ordered, and seeded ONCE from the server. Re-seeding on every
  // refetch would silently undo a selection somebody was in the middle of.
  const [chosen, setChosen] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (chosen === null && lineup.data) setChosen(lineup.data.map((row) => row.id));
  }, [chosen, lineup.data]);

  const selection = chosen ?? [];
  const save = useMutation({
    mutationFn: () => setEventCrew(eventId, selection),
    onSuccess: (rows) => {
      setError(null);
      setChosen(rows.map((row) => row.id));
      void client.invalidateQueries({ queryKey: ['organizer', 'event-crew', eventId] });
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const toggle = (id: string) =>
    setChosen((current) => {
      const list = current ?? [];
      return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
    });

  const saved = lineup.data?.map((row) => row.id).join(',') ?? '';
  const dirty = chosen !== null && chosen.join(',') !== saved;

  if (roster.isPending || lineup.isPending) return <Skeleton className="h-40 w-full" />;

  const members = roster.data ?? [];

  return (
    <div className="flex flex-col gap-stack-lg">
      <p className="text-body-sm text-muted-foreground">
        Pick from your crew list. They appear on the event page under &ldquo;Who&rsquo;s taking
        the stage&rdquo;, in the order you choose them.
      </p>

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-card py-4 text-body-sm text-muted-foreground">
          Your crew list is empty. Add somebody below and they stay available for every event
          you run.
        </p>
      ) : (
        /* A SCROLLER with a fixed maximum height, not a growing list: a
           roster of forty would otherwise push the save button off the screen
           and turn a step into a scroll. */
        <div
          role="listbox"
          aria-multiselectable
          aria-label="Crew members"
          className="flex max-h-72 flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl border border-border p-2"
        >
          {members.map((member) => {
            const index = selection.indexOf(member.id);
            const picked = index >= 0;
            return (
              <button
                key={member.id}
                type="button"
                role="option"
                aria-selected={picked}
                onClick={() => toggle(member.id)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  picked
                    ? 'border-transparent bg-nav-active text-nav-active-foreground'
                    : 'border-border bg-surface hover:bg-muted',
                )}
              >
                <span
                  aria-hidden
                  className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
                >
                  {member.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- an arbitrary storage host, which `next/image` refuses unless it is in `remotePatterns`; this is a 36px chrome element.
                    <img
                      src={member.photo_url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRound className="size-4" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm font-medium">{member.name}</span>
                  {member.role ? (
                    <span className="truncate text-caption opacity-80">{member.role}</span>
                  ) : null}
                </span>
                {/* The POSITION, not a tick. On a lineup the order is
                    information — it is what says who is headlining — so the
                    chosen state shows where somebody sits rather than only
                    that they are in. */}
                {picked ? (
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-cta text-caption font-semibold tabular-nums text-cta-foreground">
                    {index + 1}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-transparent"
                  >
                    <Check className="size-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <AddInline organizationId={organizationId} onAdded={(id) => toggle(id)} />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save lineup
        </Button>
        {/* Unsaved state is SAID, not implied by an enabled button. This step
            is server-backed and does not ride the wizard's autosave, so a
            reader has no other way to know. */}
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {dirty
            ? 'Not saved yet'
            : selection.length === 0
              ? 'Nobody on the lineup'
              : `${selection.length} on the lineup`}
        </p>
      </div>
    </div>
  );
}

/**
 * Add somebody without leaving the step.
 *
 * Deliberately just a name and a role: a photo and a bio belong on the roster
 * screen, and a full form here would turn "I forgot the support act" into a
 * detour out of a half-finished event. The new person is selected
 * immediately, because adding them here can only mean one thing.
 */
function AddInline({
  organizationId,
  onAdded,
}: {
  organizationId: string | null;
  onAdded: (id: string) => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      createCrewMember(organizationId!, { name: name.trim(), role: role.trim() }),
    onSuccess: async (member) => {
      setName('');
      setRole('');
      setOpen(false);
      setError(null);
      await client.invalidateQueries({ queryKey: ['organizer', 'crew', organizationId] });
      onAdded(member.id);
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  if (!organizationId) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border-strong px-4 py-2 text-body-sm text-muted-foreground transition-colors duration-fast hover:border-border-strong hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" aria-hidden />
        Add crew member
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-card">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="quick-crew-name" className="text-caption">
            Name
          </Label>
          <Input
            id="quick-crew-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="DJ Voices"
            autoFocus
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="quick-crew-role" className="text-caption">
            Role
          </Label>
          <Input
            id="quick-crew-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="DJ"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => name.trim() && add.mutate()}
          disabled={!name.trim() || add.isPending}
        >
          Add and select
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <p className="text-caption text-muted-foreground">
          A photo and bio can be added later from Crew.
        </p>
      </div>
    </div>
  );
}
