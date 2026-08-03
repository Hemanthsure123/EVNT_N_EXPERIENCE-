'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Megaphone, Plus, Trash2 } from 'lucide-react';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAdminAnnouncements,
  updateAnnouncement,
  type AdminAnnouncement,
  type AnnouncementKind,
} from '@/lib/api/cms';
import { ApiError } from '@/lib/api/errors';
import {
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusPill,
  type Tone,
} from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';

/**
 * The announcement manager.
 *
 * ── STATE IS DERIVED AND SHOWN, NOT LEFT TO ARITHMETIC ────────────────────
 *
 * A row is Live / Scheduled / Expired / Off, computed from the window and the
 * kill switch, and labelled. An operator looking at a list of ISO timestamps
 * has to do date maths in their head to answer "is this showing right now",
 * which is the only question they actually have.
 *
 * ── DEACTIVATE IS SEPARATE FROM DELETE ────────────────────────────────────
 *
 * `is_active` pulls a live banner instantly without touching its schedule —
 * the thing you want at 2am during an incident. Delete is permanent and sits
 * behind a second click, because the two are not the same decision.
 *
 * ── THE LINK IS PATH-ONLY, AND THE FORM SAYS SO ───────────────────────────
 *
 * The server refuses an absolute URL. Rather than let an operator find that
 * out from a 422, the field is labelled as a path and the hint explains why.
 *
 * ── EXACTLY ONE FILLED BUTTON, WHICHEVER STATE THE SCREEN IS IN ───────────
 *
 * Closed, the near-black pill is "New announcement" — the thing you came here
 * to do. Open, that button steps down to an outline (it is now a disclosure
 * toggle) and the composer's "Publish" takes the fill, because that is the
 * write. Two filled pills at once would be two controls both claiming to be
 * the point of the screen.
 *
 * The delete trigger is separated from the row's routine controls by a
 * hairline, and its confirm step is the only `destructive` fill on the page.
 */

const KINDS: { value: AnnouncementKind; label: string; hint: string }[] = [
  { value: 'maintenance', label: 'Maintenance', hint: 'Planned downtime' },
  { value: 'feature', label: 'New feature', hint: 'A launch' },
  { value: 'promotion', label: 'Promotion', hint: 'Marketing' },
  { value: 'emergency', label: 'Emergency', hint: 'Cannot be dismissed' },
];

const PLACEMENTS = [
  { value: 'home', label: 'Attendee homepage' },
  { value: 'organizer', label: 'Organizer dashboard' },
  { value: 'admin', label: 'Admin console' },
  { value: 'all', label: 'Everywhere' },
] as const;

/**
 * A native `<select>` wearing `<Input>`'s contract — same height token, same
 * `border-input` (which clears the 3:1 non-text requirement a hairline does
 * not), same focus ring. Declared once so the two selects cannot drift apart.
 */
const SELECT_CLASS =
  'flex h-control w-full rounded-md border border-input bg-surface px-3 text-body-sm text-foreground shadow-sm transition duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

type LiveState = { label: string; tone: Tone };

function stateOf(row: AdminAnnouncement, now: number): LiveState {
  if (!row.is_active) return { label: 'Off', tone: 'neutral' };
  if (row.starts_at && new Date(row.starts_at).getTime() > now) {
    return { label: 'Scheduled', tone: 'info' };
  }
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) {
    return { label: 'Expired', tone: 'neutral' };
  }
  return { label: 'Live now', tone: 'success' };
}

export function AnnouncementsAdmin() {
  const client = useQueryClient();
  const [composing, setComposing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: fetchAdminAnnouncements,
    staleTime: 0,
  });

  const refresh = () => void client.invalidateQueries({ queryKey: ['admin', 'announcements'] });

  const create = useMutation({
    mutationFn: createAnnouncement,
    onSuccess: () => {
      setError(null);
      setComposing(false);
      refresh();
    },
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not publish that.'),
  });
  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AdminAnnouncement> }) =>
      updateAnnouncement(id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: deleteAnnouncement, onSuccess: refresh });

  const rows = query.data?.data ?? [];
  const now = Date.now();

  return (
    <div className="flex flex-col gap-stack">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive-subtle bg-destructive-subtle px-card py-2 text-body-sm text-destructive-subtle-foreground"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-stack">
        <Button
          type="button"
          // Filled while it is the screen's action; outline once the composer
          // below it owns that role.
          variant={composing ? 'outline' : 'primary'}
          onClick={() => setComposing((open) => !open)}
          aria-expanded={composing}
          leftIcon={<Plus className="size-4" aria-hidden />}
        >
          New announcement
        </Button>
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">
          Published announcements go live the moment their window opens.
        </p>
      </div>

      {composing ? (
        <Composer onSubmit={(input) => create.mutate(input)} busy={create.isPending} />
      ) : null}

      <Panel title="All announcements" subtitle="Scheduled and expired ones included">
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-card">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Nothing published"
            body="Announcements appear as a thin bar above the header. Use them for maintenance windows, launches and incidents — sparingly, or people stop reading them."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const state = stateOf(row, now);
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-stack px-card py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body-sm font-medium text-foreground">
                        {row.title}
                      </span>
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      <span className="text-caption capitalize text-muted-foreground">
                        {row.kind} · {row.placement}
                      </span>
                      {!row.dismissible ? (
                        <span className="inline-flex items-center gap-1 text-caption text-warning-subtle-foreground">
                          <AlertTriangle className="size-3" aria-hidden />
                          Not dismissible
                        </span>
                      ) : null}
                    </span>
                    {row.body ? (
                      <span className="block truncate text-caption text-muted-foreground">
                        {row.body}
                      </span>
                    ) : null}
                  </span>

                  <label className="inline-flex min-h-control shrink-0 items-center gap-2 text-caption text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(event) =>
                        patch.mutate({ id: row.id, input: { is_active: event.target.checked } })
                      }
                      className="size-5 accent-primary"
                    />
                    Active
                  </label>

                  {/* Pulling a live banner (Active) is instant and reversible;
                      deleting is neither. A hairline between them. */}
                  <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />

                  <DeleteButton onConfirm={() => remove.mutate(row.id)} title={row.title} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Two clicks, inline — never a browser dialog, never a single irreversible tap. */
function DeleteButton({ onConfirm, title }: { onConfirm: () => void; title: string }) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (armed) {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        {/* Keep first, then Delete: the safe option is where the hand already
            is, and the irreversible one takes an extra inch of travel. */}
        <Button type="button" variant="outline" size="sm" onClick={() => setArmed(false)}>
          Keep
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          aria-label={`Delete ${title}`}
        >
          Delete
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setArmed(true)}
      aria-label={`Delete ${title}`}
      title={`Delete ${title}`}
      className="shrink-0 text-muted-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}

function Composer({
  onSubmit,
  busy,
}: {
  onSubmit: (input: Partial<AdminAnnouncement>) => void;
  busy: boolean;
}) {
  const [kind, setKind] = React.useState<AnnouncementKind>('maintenance');
  const [placement, setPlacement] = React.useState<AdminAnnouncement['placement']>('home');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [linkPath, setLinkPath] = React.useState('');
  const [linkLabel, setLinkLabel] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');

  // An emergency notice people can close is not an emergency notice.
  const dismissible = kind !== 'emergency';

  return (
    <Panel title="New announcement">
      <form
        className="flex flex-col gap-block p-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            kind,
            placement,
            title: title.trim(),
            body: body.trim(),
            link_path: linkPath.trim(),
            link_label: linkLabel.trim(),
            starts_at: startsAt ? new Date(startsAt).toISOString() : null,
            ends_at: endsAt ? new Date(endsAt).toISOString() : null,
            dismissible,
          });
        }}
      >
        <div className="grid gap-block sm:grid-cols-2">
          <label className="flex flex-col gap-stack">
            <span className="text-label text-foreground">Type</span>
            {/* A native select on purpose: it hands a phone the OS picker, and
                nothing here needs a custom menu. Styled to the same token
                contract as `<Input>` — `border-input` clears 3:1, which a
                hairline does not, and a field's edge is its only affordance. */}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as AnnouncementKind)}
              className={SELECT_CLASS}
            >
              {KINDS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label} — {entry.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-stack">
            <span className="text-label text-foreground">Show on</span>
            <select
              value={placement}
              onChange={(event) =>
                setPlacement(event.target.value as AdminAnnouncement['placement'])
              }
              className={SELECT_CLASS}
            >
              {PLACEMENTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Field id="ann-title" label="Title" value={title} onChange={setTitle} max={120} required />
        <Field id="ann-body" label="Body" value={body} onChange={setBody} max={400} multiline />

        <div className="grid gap-block sm:grid-cols-2">
          <Field
            id="ann-link"
            label="Link (a path on this site)"
            value={linkPath}
            onChange={setLinkPath}
            max={200}
            placeholder="/events?city=Mumbai"
            hint="Paths only. An absolute URL is refused — a banner that can point anywhere is a phishing vector on our own front page."
          />
          <Field
            id="ann-link-label"
            label="Link text"
            value={linkLabel}
            onChange={setLinkLabel}
            max={40}
            placeholder="Browse events"
          />
        </div>

        <div className="grid gap-block sm:grid-cols-2">
          <label className="flex flex-col gap-stack">
            <span className="text-label text-foreground">Starts</span>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className="text-body-sm"
            />
            <span className="text-caption text-muted-foreground">Blank means immediately.</span>
          </label>
          <label className="flex flex-col gap-stack">
            <span className="text-label text-foreground">Ends</span>
            <Input
              type="datetime-local"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(event) => setEndsAt(event.target.value)}
              className="text-body-sm"
            />
            <span className="text-caption text-muted-foreground">
              Blank means until you turn it off.
            </span>
          </label>
        </div>

        {kind === 'emergency' ? (
          <p className="flex items-start gap-2 rounded-xl border border-warning-subtle bg-warning-subtle px-card py-2 text-caption text-warning-subtle-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            An emergency notice cannot be dismissed by the reader. Use it only when everybody needs
            to see it — a banner nobody can close stops being read if it is overused.
          </p>
        ) : null}

        {/* The composer's own primary — and while it is on screen, the only
            filled pill in the section. */}
        <div>
          <Button type="submit" disabled={busy || !title.trim()} loading={busy}>
            Publish
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  max,
  placeholder,
  hint,
  multiline,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  required?: boolean;
}) {
  const near = value.length / max >= 0.8;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-stack">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {/* `--warning-subtle-foreground`, not `--warning`: amber text on a white
            page is 2.15:1, so the counter went unreadable exactly when it had
            something to say. */}
        <span
          className={cn(
            'shrink-0 text-caption tabular-nums',
            near ? 'text-warning-subtle-foreground' : 'text-muted-foreground',
          )}
        >
          {value.length}/{max}
        </span>
      </div>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          maxLength={max}
          required={required}
          placeholder={placeholder}
          rows={2}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-0 resize-y text-body-sm"
        />
      ) : (
        <Input
          id={id}
          value={value}
          maxLength={max}
          required={required}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="text-body-sm"
        />
      )}
      {hint ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
