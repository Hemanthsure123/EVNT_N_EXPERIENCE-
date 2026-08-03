'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ImagePlus, Loader2, Star, Trash2, X } from 'lucide-react';
import {
  checkFile,
  fetchEventContent,
  removeMedia,
  uploadMedia,
  type EventMedia,
  type MediaKind,
  type UploadHandle,
} from '@/lib/api/event-content';
import { ApiError } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import type { Draft } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';
import { NeedsSavedDraft, NotStored, Section, StepHeader } from './fields';
import { missingForSave } from './details-step';

/**
 * The media step — real uploads against `POST /events/{id}/media/upload`.
 *
 * ── ALT TEXT IS COLLECTED BEFORE THE UPLOAD, NOT AFTER ────────────────────
 *
 * The server rejects a file without it, so asking afterwards would mean
 * uploading six megabytes and then refusing them. More importantly, alt text
 * written while looking at the picker — with the image in mind — is real alt
 * text; a field appended to a finished grid gets "image1".
 *
 * ── PROGRESS AND CANCEL ARE REAL ──────────────────────────────────────────
 *
 * `uploadMedia` uses XHR precisely so the percentage is genuine, and cancel
 * aborts the request rather than hiding a row that keeps uploading. A cancel
 * button that does not cancel is worse than none.
 *
 * ── FAILURES STAY ON SCREEN, WITH THE SERVER'S OWN WORDS ──────────────────
 *
 * A failed upload keeps its tile and offers Retry. The message is the API's,
 * because it is written to be acted on ("that image is 14.2 MB — the limit is
 * 10 MB"), unlike anything this component could invent.
 *
 * ── WHAT IS NOT HERE, AND WHY ─────────────────────────────────────────────
 *
 * Cropping, rotation and client-side compression are absent: they are
 * non-destructive edits that need a rendition pipeline to be meaningful, and
 * the API stores exactly the bytes it is given. Reordering by drag is absent
 * because `position` has no PATCH endpoint yet — the up/down controls write
 * the field the API does accept, on create. Both are named at the foot of the
 * step rather than shipped as controls that quietly do nothing.
 *
 * ── NOTHING HERE IS THE NEAR-BLACK PILL ───────────────────────────────────
 *
 * "Choose files" and "Upload N images" are `outline`, and their cancels are
 * `ghost`. The step's one filled action is the wizard footer's Next. Two black
 * pills on one screen — one to upload, one to move on — is two claims to be the
 * thing to press, and the uploader is a means to the step, not the step.
 *
 * The Hero marker on a tile is a dark scrim pill rather than a violet one: it
 * sits on an arbitrary photograph, so its legibility has to come from a scrim
 * that does not change with the theme, not from a brand hue that might land on
 * a violet poster.
 */

type Pending = {
  key: string;
  file: File;
  kind: MediaKind;
  altText: string;
  percent: number;
  error: string | null;
  handle: UploadHandle | null;
};

const KIND_LABEL: Record<MediaKind, string> = {
  hero: 'Hero banner',
  gallery: 'Gallery',
  thumbnail: 'Thumbnail',
  mobile: 'Mobile banner',
  video: 'Video',
};

export function MediaStep({
  draft,
  onPoster,
  posterFile,
}: {
  draft: Draft;
  onPoster: (file: File | null) => void;
  posterFile: File | null;
}) {
  const eventId = draft.eventId;
  const client = useQueryClient();
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [staged, setStaged] = React.useState<File[]>([]);
  const [altDraft, setAltDraft] = React.useState<Record<string, string>>({});
  const [kind, setKind] = React.useState<MediaKind>('gallery');
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const content = useQuery({
    queryKey: ['event-content', eventId],
    queryFn: () => fetchEventContent(eventId as string),
    enabled: Boolean(eventId),
    staleTime: 0,
  });

  const drop = useMutation({
    mutationFn: (mediaId: string) => removeMedia(eventId as string, mediaId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['event-content', eventId] }),
  });

  // Paste support: an organizer copying a poster from a design tool expects
  // ⌘V to work, and it is the fastest path there is.
  React.useEffect(() => {
    if (!eventId) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) stage(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const stage = (files: File[]) => {
    const accepted: File[] = [];
    const rejected: Pending[] = [];
    for (const file of files) {
      const problem = checkFile(file);
      if (problem) {
        // Rejected client-side, but shown as a failed tile rather than a toast
        // — the organizer needs to see WHICH file was refused.
        rejected.push({
          key: `${file.name}-${Math.random()}`,
          file,
          kind,
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
    const entry: Pending = { key, file, kind, altText, percent: 0, error: null, handle: null };

    const handle = uploadMedia(
      eventId as string,
      { file, kind, altText, position: (content.data?.media.length ?? 0) + 1 },
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
        void client.invalidateQueries({ queryKey: ['event-content', eventId] });
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

  const media = content.data?.media ?? [];

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Media"
        blurb="One cover image for the card and the link preview, then a gallery for the event page. Every gallery image needs alt text — it is what a screen reader reads out, and the server requires it."
      />

      {/* THE COVER AND THE GALLERY ARE DIFFERENT THINGS, so they are different
          sections rather than one grid. `Event.poster_url` is a single column
          that decides how the event looks in every list, every search result
          and every shared link; `EventMedia` rows are the gallery on the event
          page. Merging them into one uploader would mean an organizer who adds
          nine photos still has no card image. */}
      <Section
        title="Cover image"
        blurb="Shown on cards, in search results and in every shared link."
        count={draft.posterUrl ? 'Set' : 'Not set'}
      >
        <CoverUploader draft={draft} onPoster={onPoster} posterFile={posterFile} />
      </Section>

      {!eventId ? (
        <Section title="Gallery" blurb="Photos on the event page itself.">
          <NeedsSavedDraft
            title="The gallery unlocks once the draft is saved"
            what="Gallery images are stored against the event, so it has to exist first. The cover image above works right now — it uploads with the next save."
            missing={missingForSave(draft)}
          />
        </Section>
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-stack">
        <label className="text-caption font-medium text-muted-foreground" htmlFor="media-kind">
          Uploading as
        </label>
        <select
          id="media-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as MediaKind)}
          className="h-control rounded-md border border-input bg-surface px-2.5 text-body text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {(Object.keys(KIND_LABEL) as MediaKind[])
            .filter((value) => value !== 'video')
            .map((value) => (
              <option key={value} value={value}>
                {KIND_LABEL[value]}
              </option>
            ))}
        </select>
        <p className="text-caption text-muted-foreground">
          One hero, ten gallery images. The server enforces both.
        </p>
      </div>

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
          'flex flex-col items-center gap-stack rounded-xl border-2 border-dashed p-card-lg text-center',
          'transition-colors duration-fast motion-reduce:transition-none',
          // Armed: the accent edge plus the faintest wash of it. `bg-secondary`
          // is a neutral grey now, which read as "disabled" rather than "let
          // go here".
          over ? 'border-primary bg-primary/5' : 'border-border bg-sunken',
        )}
      >
        <span
          className="inline-flex size-12 items-center justify-center rounded-full bg-muted"
          aria-hidden
        >
          <ImagePlus className="size-5 text-muted-foreground" />
        </span>
        <p className="text-body-sm font-medium">Drop images here, or paste with ⌘V</p>
        <p className="max-w-sm text-caption text-muted-foreground">
          JPEG, PNG, WebP, AVIF or GIF, up to 10 MB. Landscape at 1200×800 or larger works best —
          cards crop to 3:2.
        </p>
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Choose images to upload"
          onChange={(event) => {
            stage(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {/* Alt text is collected BEFORE the bytes go up — the server refuses a
          file without it, and text written with the image in mind is real alt
          text rather than "image1". */}
      {staged.length ? (
        <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
          <h3 className="text-body-sm font-semibold">
            Describe {staged.length === 1 ? 'this image' : 'these images'} before uploading
          </h3>
          <ul className="flex flex-col gap-stack">
            {staged.map((file, index) => {
              const id = `${file.name}-${index}`;
              return (
                <li key={id} className="flex flex-col gap-1.5">
                  <label htmlFor={`alt-${id}`} className="truncate text-caption font-medium">
                    {file.name}
                  </label>
                  <Input
                    id={`alt-${id}`}
                    value={altDraft[id] ?? ''}
                    onChange={(event) =>
                      setAltDraft((current) => ({ ...current, [id]: event.target.value }))
                    }
                    placeholder="What is in the picture? e.g. The main stage at dusk, crowd in front"
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-stack">
            <Button
              variant="outline"
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
              Upload {staged.length === 1 ? 'image' : `${staged.length} images`}
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
                  if (!checkFile(row.file)) start(row.file, row.altText);
                  else setStaged((current) => [...current, row.file]);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {content.isError ? (
        <ErrorState
          message="Could not load this event's media."
          onRetry={() => void content.refetch()}
          className="rounded-xl border border-border bg-surface shadow-sm"
        />
      ) : content.isPending ? (
        <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index}>
              <Skeleton className="aspect-card w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : media.length === 0 && pending.length === 0 && staged.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={ImagePlus}
            title="No gallery images yet"
            body="Four or five photographs of the last one sell an event better than any amount of description. A crowd shot works harder than an empty stage."
          />
        </div>
      ) : (
        <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
          {media.map((item) => (
            <li key={item.id}>
              <MediaTile media={item} busy={drop.isPending} onRemove={() => drop.mutate(item.id)} />
            </li>
          ))}
        </ul>
      )}
        </>
      )}

      <NotStored>
        Cropping, rotation and client-side compression are not offered: the API stores exactly the
        bytes it is given, so a crop here would be destructive rather than a rendition. Drag-to-
        reorder is absent for the same reason — <code>position</code> is set on upload and has no
        update endpoint yet. Video is in the model but has no upload path (the validator is
        image-only), so the kind is not offered. All three are backend dependencies, not omissions.
      </NotStored>
    </div>
  );
}

/**
 * The cover image.
 *
 * Held locally and uploaded with the next autosave rather than immediately,
 * because `poster` is a field on the event's own optimistic-locked PATCH — not
 * a separate resource. So the preview is instant, the network is not hit per
 * drag, and the file name plus "uploads with the next save" makes the pending
 * state visible instead of assumed. A `File` cannot be JSON-serialised into
 * localStorage, so a refresh before that save loses it; the label says so.
 */
function CoverUploader({
  draft,
  onPoster,
  posterFile,
}: {
  draft: Draft;
  onPoster: (file: File | null) => void;
  posterFile: File | null;
}) {
  const [over, setOver] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const take = (candidate: File | undefined) => {
    if (!candidate) return;
    // The same pre-check the gallery uses, so a 14 MB cover is refused here
    // rather than at the end of the next autosave.
    const rejected = checkFile(candidate);
    setProblem(rejected);
    if (!rejected) onPoster(candidate);
  };

  return (
    <div className="flex flex-col gap-stack">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-stack rounded-xl border-2 border-dashed p-card-lg text-center',
          'transition-colors duration-fast motion-reduce:transition-none',
          over ? 'border-primary bg-primary/5' : 'border-border bg-sunken',
        )}
      >
        {draft.posterUrl ? (
          <>
            <div className="w-full max-w-md overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob:
                  URL until the save lands, then a storage-adapter URL; neither
                  is a host next/image can be configured for. */}
              <img
                src={draft.posterUrl}
                alt="Cover preview"
                className="aspect-card w-full object-cover"
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-stack">
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                Replace
              </Button>
              {/* Ghost, and after Replace: clearing the cover is the one thing
                  on this panel somebody would not want to do by accident. */}
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="size-3.5" aria-hidden />}
                onClick={() => {
                  setProblem(null);
                  onPoster(null);
                }}
              >
                Remove
              </Button>
            </div>
            {posterFile ? (
              <p className="text-caption text-muted-foreground">
                {posterFile.name} · {(posterFile.size / 1024).toFixed(0)} KB · uploads with the next
                save
              </p>
            ) : null}
          </>
        ) : (
          <>
            <span
              className="inline-flex size-12 items-center justify-center rounded-full bg-muted"
              aria-hidden
            >
              <ImagePlus className="size-5 text-muted-foreground" />
            </span>
            <p className="text-body-sm font-medium">Drop the cover image here</p>
            <p className="max-w-sm text-caption text-muted-foreground">
              Landscape, at least 1200×800. It is cropped to 3:2 on cards, so keep faces and text
              away from the edges.
            </p>
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Cover image"
          onChange={(event) => {
            take(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      {problem ? (
        <p role="alert" className="text-caption text-destructive">
          {problem}
        </p>
      ) : null}
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
        'flex h-full flex-col gap-stack rounded-xl border p-card shadow-sm',
        failed ? 'border-destructive bg-destructive-subtle' : 'border-border bg-surface',
      )}
    >
      <p className="flex items-center gap-2 truncate text-body-sm font-medium">
        {failed ? (
          <AlertTriangle
            className="size-4 shrink-0 text-destructive-subtle-foreground"
            aria-hidden
          />
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

function MediaTile({
  media,
  busy,
  onRemove,
}: {
  media: EventMedia;
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
    <figure className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-card w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- the URL comes
            from a configurable storage adapter, so it is not a host next/image
            can be told about at build time. */}
        <img src={media.url} alt={media.alt_text} className="size-full object-cover" />
        {media.kind === 'hero' ? (
          // A scrim pill, not a brand fill: what is behind it is an arbitrary
          // photograph, so the contrast has to come from the scrim. `--overlay`
          // and `--on-gradient` are the two tokens that deliberately do NOT
          // flip with the theme, for exactly this reason.
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-overlay/85 px-2 py-0.5 text-caption text-on-gradient backdrop-blur-glass">
            <Star className="size-3" aria-hidden />
            Hero
          </span>
        ) : null}
      </div>

      <figcaption className="flex min-w-0 flex-1 flex-col gap-1.5 p-card">
        <p className="truncate text-caption text-muted-foreground">{KIND_LABEL[media.kind]}</p>
        <p className="line-clamp-2 text-body-sm">{media.alt_text}</p>

        {/* Armed, Keep comes FIRST. The safe way out is the one under the
            pointer that just pressed the trash icon; the irreversible one is
            the one you have to travel to. */}
        <div className="mt-auto pt-stack">
          {armed ? (
            <span className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setArmed(false)}>
                Keep
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setArmed(true)}
              aria-label={`Remove ${media.alt_text || 'this image'}`}
              className="hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
