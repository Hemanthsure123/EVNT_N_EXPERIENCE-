'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2, UserRound, X } from 'lucide-react';
import {
  CREW_PHOTO_MAX_BYTES,
  CREW_PHOTO_TYPES,
  createCrewMember,
  deleteCrewMember,
  fetchCrew,
  updateCrewMember,
  uploadCrewPhoto,
  type CrewMember,
} from '@/lib/api/crew';
import { errorMessage } from '@/lib/api/errors';
import { useOrganizations } from '@/lib/identity/scope';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Panel, Skeleton } from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The crew roster — the people an organizer puts on stage.
 *
 * ── IT IS A ROSTER, NOT A PER-EVENT LIST, AND THAT IS THE WHOLE DESIGN ────
 *
 * A promoter who runs the same night monthly adds their resident ONCE and
 * picks them for every event. So this screen owns the people and the event
 * wizard only owns the choosing — which is why the roster hangs off the
 * organization and the lineup hangs off the event.
 *
 * ── CARDS, NOT A TABLE ───────────────────────────────────────────────────
 *
 * Every other list on this dashboard is a table because every other list is
 * data you scan, sort and export. A roster is a set of PEOPLE, and the
 * photograph is the field somebody actually recognises them by — a 40px
 * thumbnail in a table cell is the wrong size for the only column that
 * matters here.
 */
export function CrewRoster() {
  const organizations = useOrganizations();
  const organization = organizations.data?.data?.[0] ?? null;
  const [editing, setEditing] = React.useState<CrewMember | null>(null);
  const [adding, setAdding] = React.useState(false);

  const roster = useQuery({
    queryKey: ['organizer', 'crew', organization?.id],
    queryFn: () => fetchCrew(organization!.id),
    enabled: Boolean(organization?.id),
    staleTime: 30_000,
  });

  if (organizations.isPending) return <Skeleton className="h-64 w-full" />;

  // ABSENT, not broken. Somebody with no organization has nothing to build a
  // roster for, and the honest answer names the missing step.
  if (!organization) {
    return (
      <Panel title="Crew">
        <p className="text-body-sm text-muted-foreground">
          Create an organisation first — a crew list belongs to the organisation that books
          them, so it can be reused across every event you run.
        </p>
      </Panel>
    );
  }

  const members = roster.data ?? [];

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-stack sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-h3 md:text-h2">Crew</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            The people you put on stage. Add them once here and pick them when you create an
            event — they appear on the event page under &ldquo;Who&rsquo;s taking the
            stage&rdquo;.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden />
          Add crew member
        </Button>
      </header>

      {roster.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyRoster onAdd={() => setAdding(true)} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} onEdit={() => setEditing(member)} />
            </li>
          ))}
        </ul>
      )}

      <MemberSheet
        organizationId={organization.id}
        member={editing}
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function EmptyRoster({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-stack-lg rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span
        aria-hidden
        className="inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <UserRound className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body font-medium text-foreground">No crew yet</p>
        <p className="text-body-sm text-muted-foreground">
          Add the DJs, hosts and acts you work with. You only do this once — every event you
          create can pick from the same list.
        </p>
      </div>
      <Button onClick={onAdd} className="gap-1.5">
        <Plus className="size-4" aria-hidden />
        Add crew member
      </Button>
    </div>
  );
}

function MemberCard({ member, onEdit }: { member: CrewMember; onEdit: () => void }) {
  return (
    <div
      className={cn(
        'flex h-full items-start gap-3 rounded-2xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast',
        // A retired member is dimmed rather than hidden: this screen is where
        // somebody is brought back, so removing them from it would remove the
        // only route to undoing the decision.
        !member.is_active && 'opacity-60',
      )}
    >
      <Portrait member={member} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-body font-semibold text-foreground">{member.name}</p>
        {member.role ? (
          <p className="truncate text-body-sm text-muted-foreground">{member.role}</p>
        ) : null}
        {!member.is_active ? (
          <span className="mt-1 w-fit rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
            Not on new events
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${member.name}`}
        className="-mr-1 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function Portrait({ member, size = 'md' }: { member: CrewMember; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-10' : 'size-14';
  if (!member.photo_url) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground',
          box,
        )}
      >
        <UserRound className="size-5" />
      </span>
    );
  }
  return (
    <span className={cn('relative shrink-0 overflow-hidden rounded-xl bg-muted', box)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an arbitrary storage host, and `next/image` refuses any origin absent from `remotePatterns`; this is a 56px chrome element. */}
      <img
        src={member.photo_url}
        alt={member.photo_alt_text || ''}
        loading="lazy"
        className="size-full object-cover"
      />
    </span>
  );
}

/**
 * Add or edit one person.
 *
 * ── ALT TEXT IS COLLECTED BEFORE THE BYTES GO UP ─────────────────────────
 *
 * The server refuses a photo without it, and that is deliberate rather than
 * awkward: text written while looking at the picture is real alt text, where a
 * field appended to a finished grid gets "image1". The upload button is
 * disabled until it is there, and says why.
 *
 * ── THE PHOTO IS A SECOND STEP FOR A NEW MEMBER, AND IT SAYS SO ──────────
 *
 * A portrait attaches to a row that exists, so a brand-new member is saved
 * first. Rather than hiding that behind a spinner, the form names it: the
 * picture control appears once there is somebody to attach it to.
 */
function MemberSheet({
  organizationId,
  member,
  open,
  onClose,
}: {
  organizationId: string;
  member: CrewMember | null;
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  /**
   * The member this sheet just created, if it did.
   *
   * `subject` is what the body reads, so the form does not have to know whether
   * it is in "add" or "edit" mode — it is editing whoever exists, and after a
   * create that is the person who was just added.
   */
  const [created, setCreated] = React.useState<CrewMember | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCreated(null);
    setName(member?.name ?? '');
    setRole(member?.role ?? '');
    setDetails(member?.details ?? '');
    setError(null);
  }, [open, member]);

  /** Whoever this sheet is acting on: the member it was opened for, or the one
   *  it just created. One value, so no control below has to ask which. */
  const subject = member ?? created;

  const invalidate = () =>
    client.invalidateQueries({ queryKey: ['organizer', 'crew', organizationId] });

  const save = useMutation({
    // `subject`, NOT `member`. After a create the sheet stays open on the person
    // it just added, so a second Save has to UPDATE them — branching on `member`
    // would create a duplicate crew member every time somebody corrected a
    // typo before closing.
    mutationFn: () =>
      subject
        ? updateCrewMember(organizationId, subject.id, {
            name: name.trim(),
            role: role.trim(),
            details,
          })
        : createCrewMember(organizationId, { name: name.trim(), role: role.trim(), details }),
    /**
     * A NEW member stays on screen so the photo can go on now.
     *
     * The sheet used to close on every save, and the photo control only exists
     * for a member who already has a row — so adding somebody meant: fill the
     * form, save, watch it close, find them in the list, press edit, then
     * upload. Five steps for one person, and the only signposting was a line of
     * small print saying to save first. It reads as "there is no option to add
     * their photo", which is what it amounted to.
     *
     * The two-step ORDER is still real and is not a limitation to design away:
     * a portrait attaches to a row, so the row has to exist. What was wrong was
     * making somebody navigate back to the thing they had just created. The
     * created member is adopted here, the sheet switches to its edit state, and
     * the photo field appears in place.
     *
     * EDITING still closes: that form was opened to change a field, the change
     * is saved, and the photo control was already there the whole time.
     */
    onSuccess: async (saved) => {
      await invalidate();
      if (subject) return onClose();
      setCreated(saved);
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const retire = useMutation({
    mutationFn: () =>
      member
        ? updateCrewMember(organizationId, member.id, { is_active: !member.is_active })
        : Promise.reject(new Error('No member')),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const remove = useMutation({
    mutationFn: () => (member ? deleteCrewMember(organizationId, member.id) : Promise.resolve()),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    // The server's message names the alternative ("Deactivate them instead"),
    // so it is shown verbatim rather than replaced with something generic.
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent
        side="responsive"
        aria-label={subject ? 'Edit crew member' : 'Add crew member'}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>{subject ? 'Edit crew member' : 'Add crew member'}</DrawerTitle>
            <DrawerDescription>
              They appear on your event pages under &ldquo;Who&rsquo;s taking the stage&rdquo;.
            </DrawerDescription>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto px-6 py-card-lg">
            <div className="flex flex-col gap-2">
              <Label htmlFor="crew-name">Name</Label>
              <Input
                id="crew-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="DJ Voices"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="crew-role">Role</Label>
              <Input
                id="crew-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="DJ"
              />
              {/* Free text on purpose. "DJ", "compere", "sound", "aerialist" —
                  a fixed list would be wrong within a week. */}
              <p className="text-caption text-muted-foreground">
                Whatever they are billed as. Shown under their name on the event page.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="crew-details">Details</Label>
              <Textarea
                id="crew-details"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={3}
                placeholder="Anything worth knowing — a short bio, links, what they play."
              />
            </div>

            {subject ? (
              <PhotoField
                organizationId={organizationId}
                member={subject}
                onDone={invalidate}
                /* Named the moment they are created, because that is when the
                   step is not obvious. On an ordinary edit the control needs no
                   explanation. */
                hint={created ? `${created.name} is saved. Add a photo now, or close.` : undefined}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-card py-3 text-caption text-muted-foreground">
                A photo attaches to somebody who exists, so it appears here the moment you save.
              </p>
            )}

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive-subtle bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
              >
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 flex-col gap-2 border-t border-border px-6 py-card">
            <Button type="submit" size="lg" disabled={!name.trim() || save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {member ? 'Save changes' : 'Add to crew'}
            </Button>
            {member ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => retire.mutate()}
                  disabled={retire.isPending}
                >
                  {member.is_active ? 'Retire' : 'Bring back'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 text-destructive hover:bg-destructive-subtle hover:text-destructive-subtle-foreground"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              </div>
            ) : null}
          </footer>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function PhotoField({
  organizationId,
  member,
  onDone,
  hint,
}: {
  organizationId: string;
  member: CrewMember;
  onDone: () => void | Promise<unknown>;
  /** Shown only where the step is not obvious — right after a create. */
  hint?: string;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [altText, setAltText] = React.useState(member.photo_alt_text ?? '');
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const handle = React.useRef<{ cancel: () => void } | null>(null);

  const pick = (chosen: File | null) => {
    setError(null);
    if (!chosen) return setFile(null);
    // Refuse locally what the server would refuse anyway, before spending
    // somebody's data on the round trip.
    if (!CREW_PHOTO_TYPES.includes(chosen.type)) {
      return setError('That file type is not accepted. Use a JPEG, PNG, WebP or AVIF.');
    }
    if (chosen.size > CREW_PHOTO_MAX_BYTES) {
      return setError(
        `That file is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
      );
    }
    setFile(chosen);
  };

  const start = () => {
    if (!file || !altText.trim()) return;
    setError(null);
    setProgress(0);
    const upload = uploadCrewPhoto(
      organizationId,
      member.id,
      { file, altText: altText.trim() },
      setProgress,
    );
    handle.current = upload;
    void upload.promise
      .then(async () => {
        setFile(null);
        setProgress(null);
        await onDone();
      })
      .catch((thrown: Error) => {
        setProgress(null);
        setError(thrown.message);
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="crew-photo">Photo</Label>
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      <div className="flex items-start gap-3 rounded-xl border border-border p-card">
        <Portrait member={member} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            id="crew-photo"
            type="file"
            accept={CREW_PHOTO_TYPES.join(',')}
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
            className="text-caption file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-caption file:font-medium"
          />

          {file ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="crew-alt" className="text-caption">
                  Describe the photo
                </Label>
                <Input
                  id="crew-alt"
                  value={altText}
                  onChange={(event) => setAltText(event.target.value)}
                  placeholder="A DJ behind a mixer, smiling"
                />
                {/* Said before the press, not after a refusal. */}
                <p className="text-caption text-muted-foreground">
                  Required. It is what someone using a screen reader hears in place of the
                  picture.
                </p>
              </div>

              {progress === null ? (
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" onClick={start} disabled={!altText.trim()}>
                    Upload photo
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)}>
                    <X className="size-4" aria-hidden />
                    Clear
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Upload progress"
                  >
                    <div
                      className="h-full bg-primary transition-[width] duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {/* A real abort handle, not a button that hides a request
                      which is still running. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handle.current?.cancel()}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </>
          ) : null}

          {error ? (
            <p role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
