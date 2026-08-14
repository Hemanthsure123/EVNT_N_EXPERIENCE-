'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ImagePlus, Loader2, Star, Trash2, X } from 'lucide-react';
import {
  checkPhoto,
  removePerformerPhoto,
  uploadPerformerPhoto,
  type PerformerPhoto,
  type PhotoUploadHandle,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { useAct, useInvalidatePerformer } from '@/lib/performer/studio';
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { PhotoGallery } from '@/components/hire/photo-gallery';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { RemoteImage } from '@/components/ui/remote-image';

/**
 * The gallery manager.
 *
 * ── ALT TEXT IS COLLECTED BEFORE THE UPLOAD ───────────────────────────────
 *
 * The server refuses a photo without it, so asking afterwards would mean
 * sending six megabytes and then rejecting them. More importantly, alt text
 * written while looking at the picker — with the image in mind — is real alt
 * text; a field appended to a finished grid gets "image1".
 *
 * ── THE FIRST PHOTO IS THE ONE EVERYONE SEES ──────────────────────────────
 *
 * The marketplace card shows `photos[0]`, ordered by `position`. That is worth
 * saying out loud on this screen, because it is the single highest-leverage
 * thing here and it is invisible otherwise.
 *
 * ── REORDERING IS NOT OFFERED, AND WHY ────────────────────────────────────
 *
 * `position` is set on upload and there is no PATCH on a media row. A drag
 * handle would write nothing — so instead the order is stated, and the way to
 * change which photo leads is to remove and re-upload. That is worse than
 * dragging, and it is honest; a handle that silently reverts on reload is not.
 * BACKLOG "Reorder performer photos".
 *
 * ── THE FILLED BUTTON MOVES WITH THE JOB ──────────────────────────────────
 *
 * With nothing staged, "Choose photos" is the one near-black pill on the
 * screen. The moment files are waiting on their alt text, THAT becomes the
 * primary action and the dropzone's button steps down to an outline — two
 * filled pills competing would leave somebody guessing which one commits the
 * upload, on the only screen here that spends their bandwidth.
 */
const MAX_PHOTOS = 12;

type Pending = {
  key: string;
  file: File;
  altText: string;
  percent: number;
  error: string | null;
  handle: PhotoUploadHandle | null;
};

export function PhotoManager({ performerId }: { performerId: string }) {
  const act = useAct(performerId);
  const invalidate = useInvalidatePerformer();

  const [pending, setPending] = React.useState<Pending[]>([]);
  const [staged, setStaged] = React.useState<File[]>([]);
  const [altDraft, setAltDraft] = React.useState<Record<string, string>>({});
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const photos = act.data?.photos ?? [];
  const room = MAX_PHOTOS - photos.length - pending.length;

  const drop = useMutation({
    mutationFn: (mediaId: string) => removePerformerPhoto(performerId, mediaId),
    onSuccess: () => invalidate(),
  });

  // ⌘V. Somebody copying a photo from a design tool or a phone expects paste
  // to work, and it is the fastest path there is.
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) stage(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const stage = (files: File[]) => {
    const accepted: File[] = [];
    const rejected: Pending[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      const problem = checkPhoto(file);
      if (problem) {
        // Shown as a failed tile rather than a toast — the owner needs to see
        // WHICH file was refused.
        rejected.push({
          key: `${file.name}-${Math.random()}`,
          file,
          altText: '',
          percent: 0,
          error: problem,
          handle: null,
        });
      } else {
        accepted.push(file);
      }
    }
    if (rejected.length) setPending((current) => [...rejected, ...current]);
    if (accepted.length) setStaged((current) => [...current, ...accepted]);
  };

  const start = (file: File, altText: string) => {
    const key = `${file.name}-${Date.now()}-${Math.random()}`;
    const entry: Pending = { key, file, altText, percent: 0, error: null, handle: null };

    const handle = uploadPerformerPhoto(
      performerId,
      { file, altText, position: photos.length + 1 },
      (percent) =>
        setPending((current) =>
          current.map((row) => (row.key === key ? { ...row, percent } : row)),
        ),
    );
    entry.handle = handle;
    setPending((current) => [entry, ...current]);

    handle.promise
      .then(() => {
        setPending((current) => current.filter((row) => row.key !== key));
        invalidate();
      })
      .catch((thrown) => {
        if (thrown instanceof ApiError && thrown.code === 'cancelled') {
          setPending((current) => current.filter((row) => row.key !== key));
          return;
        }
        setPending((current) =>
          current.map((row) =>
            row.key === key
              ? {
                  ...row,
                  handle: null,
                  error: thrown instanceof ApiError ? thrown.message : 'That upload failed.',
                }
              : row,
          ),
        );
      });
  };

  if (act.isError) {
    return (
      <ErrorState
        message="Could not load your photos."
        onRetry={() => void act.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">Photos</h1>
        <p className="text-body-sm text-muted-foreground">
          Up to {MAX_PHOTOS}. The first one is your card in the marketplace — it is the single
          biggest thing that decides whether somebody opens your profile.
        </p>
      </header>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          stage(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          'flex flex-col items-center gap-stack rounded-xl border-2 border-dashed px-card py-block-lg text-center',
          'transition-colors duration-fast motion-reduce:transition-none',
          // Violet on the drag-over hairline: a selected/armed boundary is
          // exactly the wayfinding job the accent kept.
          over ? 'border-primary bg-sunken' : 'border-border',
          room <= 0 && 'opacity-60',
        )}
      >
        <span
          className="inline-flex size-12 items-center justify-center rounded-full bg-muted"
          aria-hidden
        >
          <ImagePlus className="size-5 text-primary" />
        </span>
        <p className="text-body-sm font-medium">
          {room > 0 ? 'Drop photos here, or paste with ⌘V' : 'You have reached the maximum'}
        </p>
        <p className="max-w-sm text-caption text-muted-foreground">
          {room > 0
            ? 'JPEG, PNG, WebP, AVIF or GIF, up to 10 MB. Landscape works best — cards crop to 4:3. Pictures of the act performing beat posed studio shots.'
            : 'Remove one to add another.'}
        </p>
        <Button
          variant={staged.length ? 'outline' : 'primary'}
          disabled={room <= 0}
          onClick={() => inputRef.current?.click()}
        >
          Choose photos
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Choose photos to upload"
          onChange={(event) => {
            stage(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {/* Alt text BEFORE the bytes go up — the server refuses without it. */}
      {staged.length ? (
        <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
          <h2 className="text-body-sm font-semibold">
            Describe {staged.length === 1 ? 'this photo' : 'these photos'} before uploading
          </h2>
          <ul className="flex flex-col gap-stack">
            {staged.map((file, index) => {
              const id = `${file.name}-${index}`;
              return (
                <li key={id} className="flex flex-col gap-1.5">
                  <label htmlFor={`alt-${id}`} className="truncate text-caption font-medium">
                    {file.name}
                  </label>
                  <input
                    id={`alt-${id}`}
                    value={altDraft[id] ?? ''}
                    onChange={(event) =>
                      setAltDraft((current) => ({ ...current, [id]: event.target.value }))
                    }
                    placeholder="What is in the picture? e.g. The four of us on stage at a wedding reception"
                    className="h-control rounded-full border border-input bg-sunken px-pill text-body-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            {/* Still disabled until every staged file has alt text — the server
                refuses without it, so the gate stays where it was. */}
            <Button
              disabled={staged.some(
                (file, index) => !(altDraft[`${file.name}-${index}`] ?? '').trim(),
              )}
              onClick={() => {
                staged.forEach((file, index) =>
                  start(file, (altDraft[`${file.name}-${index}`] ?? '').trim()),
                );
                setStaged([]);
                setAltDraft({});
              }}
            >
              Upload {staged.length === 1 ? 'photo' : `${staged.length} photos`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStaged([]);
                setAltDraft({});
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      {pending.length ? (
        <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((row) => (
            <li key={row.key}>
              <PendingTile
                row={row}
                onCancel={() => {
                  row.handle?.cancel();
                  setPending((current) => current.filter((item) => item.key !== row.key));
                }}
                onRetry={() => {
                  setPending((current) => current.filter((item) => item.key !== row.key));
                  if (!checkPhoto(row.file)) start(row.file, row.altText);
                  else setStaged((current) => [...current, row.file]);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {act.isPending ? (
        <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index}>
              <Skeleton className="aspect-feature w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : photos.length === 0 && pending.length === 0 && staged.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-card py-section text-center shadow-sm">
          <p className="text-body font-medium">No photos yet</p>
          <p className="max-w-sm text-body-sm text-muted-foreground">
            An act nobody can see is an act nobody hires. One good photo is the difference between
            a profile people open and one they scroll past.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-stack">
            <h2 className="text-body-sm font-semibold">Your gallery</h2>
            <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  <PhotoTile
                    photo={photo}
                    isCover={index === 0}
                    busy={drop.isPending}
                    onRemove={() => drop.mutate(photo.id)}
                  />
                </li>
              ))}
            </ul>
            {/* Stated rather than offered as a control that writes nothing. */}
            <p className="text-caption text-muted-foreground">
              Photos appear in the order they were uploaded, and the first is your card. Reordering
              needs a backend change — to change which one leads, remove it and upload it again.
            </p>
          </section>

          <section className="flex flex-col gap-stack">
            <h2 className="text-body-sm font-semibold">How they look on your profile</h2>
            {/* The SAME gallery the public profile renders — a second preview
                implementation is a second thing to drift. */}
            <PhotoGallery photos={photos} name={act.data?.stage_name ?? 'Your act'} />
          </section>
        </>
      )}
    </div>
  );
}

function PendingTile({
  row,
  onCancel,
  onRetry,
}: {
  row: Pending;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const failed = Boolean(row.error);
  return (
    <div
      className={cn(
        'flex h-full flex-col gap-2 rounded-xl border p-stack-lg',
        failed
          ? 'border-destructive-subtle bg-destructive-subtle'
          : 'border-border bg-surface shadow-sm',
      )}
    >
      <p className="flex items-center gap-2 truncate text-body-sm font-medium">
        {failed ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        )}
        <span className="truncate">{row.file.name}</span>
      </p>

      {failed ? (
        <p className="text-caption text-destructive-subtle-foreground">{row.error}</p>
      ) : (
        <>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={row.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${row.file.name}`}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-fast ease-out motion-reduce:transition-none"
              style={{ width: `${row.percent}%` }}
            />
          </div>
          <p className="text-caption tabular-nums text-muted-foreground">{row.percent}%</p>
        </>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        {failed ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            leftIcon={<X className="size-3.5" aria-hidden />}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  isCover,
  busy,
  onRemove,
}: {
  photo: PerformerPhoto;
  isCover: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <figure className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-feature w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- the URL comes
            from a configurable storage adapter, not a host next/image can be
            told about at build time. */}
        <RemoteImage
          src={photo.url}
          alt={photo.alt_text}
          className="size-full object-cover"
          fallback={
            <span className="flex size-full items-center justify-center px-2 text-center text-caption text-muted-foreground">
              Could not load — try uploading it again.
            </span>
          }
        />
        {/* A MARKER, not an action — which is the one job the violet accent
            kept. It is a solid fill because what sits behind it is an arbitrary
            photograph, so a tint could land on anything. */}
        {isCover ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-caption text-primary-foreground">
            <Star className="size-3" aria-hidden />
            Your card
          </span>
        ) : null}
      </div>

      <figcaption className="flex min-w-0 flex-1 flex-col gap-1.5 p-stack-lg">
        <p className="line-clamp-2 text-body-sm">{photo.alt_text}</p>
        {photo.caption ? (
          <p className="line-clamp-2 text-caption text-muted-foreground">{photo.caption}</p>
        ) : null}

        {/* The destructive fill exists ONLY in the armed state, beside its own
            escape — it never sits next to a routine control at rest, where the
            trigger is a quiet icon button instead. */}
        <div className="mt-auto pt-2">
          {armed ? (
            <span className="flex gap-1.5">
              <Button variant="destructive" size="sm" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
              <Button variant="outline" size="sm" onClick={() => setArmed(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setArmed(true)}
              aria-label={`Remove ${photo.alt_text || 'this photo'}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
