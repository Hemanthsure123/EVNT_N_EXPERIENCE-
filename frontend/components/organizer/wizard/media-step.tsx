'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  EVENT_IMAGE_HINT,
  addMedia,
  checkImageFile,
  fetchEventContent,
  removeMedia,
  reorderMedia,
  updateMedia,
  uploadMedia,
  type EventMedia,
  type MediaKind,
  type UploadHandle,
} from '@/lib/api/event-content';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import type { Draft } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';
import { Section, StepHeader, type DraftSave } from './fields';
import { missingForSave } from './details-step';
import { Poster } from '@/components/organizer/primitives';

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
 * the API stores exactly the bytes it is given. Video is excluded because the
 * upload validator is image-only, so offering the kind would guarantee a 422.
 * Both are named at the foot of the step rather than shipped as controls that
 * quietly do nothing.
 *
 * REORDERING AND ALT-TEXT EDITING ARE REAL NOW. Both were previously absent
 * for the same honest reason — there was no PATCH on a media row — and both
 * have one: the whole order is written in a single transaction, so a failed
 * move cannot leave the gallery half-sorted. Up/down rather than drag, because
 * the grid is two or three columns at different widths (so "up" is not a fixed
 * direction on screen) and a drag handle is unusable by keyboard without
 * reimplementing the entire interaction.
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
  save,
}: {
  draft: Draft;
  onPoster: (file: File | null) => void;
  posterFile: File | null;
  /** The save engine's health, for the gallery panel's honest closing line. */
  save?: DraftSave;
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

  const reorder = useMutation({
    mutationFn: (items: { id: string; position: number }[]) =>
      reorderMedia(eventId as string, items),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['event-content', eventId] }),
  });

  const editAlt = useMutation({
    mutationFn: ({ id, altText }: { id: string; altText: string }) =>
      updateMedia(eventId as string, id, { alt_text: altText }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['event-content', eventId] }),
  });

  /**
   * Swap an image with its neighbour, and send the WHOLE order.
   *
   * Positions are only meaningful among siblings of the same kind, so the
   * swap happens inside the filtered list and the request carries every row
   * in it renumbered from zero. Sending just the two that moved would leave
   * the rest of the list holding whatever positions history gave them, which
   * is how an order drifts until two images claim the same slot.
   */
  const move = (list: EventMedia[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target] as EventMedia, next[index] as EventMedia];
    reorder.mutate(next.map((item, position) => ({ id: item.id, position })));
  };

  // Paste support: an organizer copying a poster from a design tool expects
  // ⌘V to work, and it is the fastest path there is.
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) void stage(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Async now, because measuring a picture means decoding its header. The
  // await is per-file and off the main thread; a dozen dropped files resolve
  // in a few milliseconds, and the alternative is finding out after the bytes
  // have already gone up.
  const stage = async (files: File[]) => {
    const accepted: File[] = [];
    const rejected: Pending[] = [];
    for (const file of files) {
      const problem = await checkImageFile(file);
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

  /**
   * The next free slot for a kind, counting what is already staged.
   *
   * `claimed` is bumped per call rather than read back from the query,
   * because a batch of five is queued in one tick and the cache has not been
   * invalidated yet — reading it would hand all five the same number.
   */
  const claimed = React.useRef<Record<string, number>>({});
  const nextPosition = (forKind: MediaKind) => {
    const existing = (content.data?.media ?? []).filter((item) => item.kind === forKind).length;
    const taken = claimed.current[forKind] ?? 0;
    claimed.current[forKind] = taken + 1;
    return existing + taken;
  };

  const start = (file: File, altText: string, forKind: MediaKind = kind) => {
    // `forKind` is passed rather than read off state, because a QUEUED file is
    // uploaded later — possibly after the organiser has changed the selector
    // to something else. Reading `kind` at flush time would file a gallery
    // photo as the hero, silently, and the hero is the card image on every
    // list on the platform.
    const key = `${file.name}-${Date.now()}-${Math.random()}`;
    const entry: Pending = {
      key,
      file,
      kind: forKind,
      altText,
      percent: 0,
      error: null,
      handle: null,
    };

    const handle = uploadMedia(
      eventId as string,
      // PER KIND, and incremented across the batch. It used to be
      // `media.length + 1` for every file in a staged batch, counting media of
      // ALL kinds — so five files at once all claimed the same position and
      // only looked ordered because the server falls back to `created_at`.
      { file, kind: forKind, altText, position: nextPosition(forKind) },
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

  /**
   * Send every described image, or hold them until there is somewhere to send
   * them to.
   *
   * ── WHY THE QUEUE EXISTS ──────────────────────────────────────────────
   *
   * `POST /events/{id}/media/upload` needs an event id, and before the first
   * save there is not one. The old answer was to disable the whole section
   * until the draft saved. This is the same answer the COVER image has always
   * given instead: keep the bytes on this device and send them the moment the
   * id arrives.
   *
   * The files live in component state rather than in the draft on purpose —
   * the draft is persisted to `localStorage`, and a `File` does not survive
   * `JSON.stringify`. So a queued image is lost on a reload, which is why the
   * panel says "when the draft saves" rather than implying it is safe: the
   * wizard autosaves within seconds of the required fields existing, so the
   * window is small, and claiming more than that would be the lie.
   */
  const [queued, setQueued] = React.useState<
    { file: File; altText: string; kind: MediaKind }[]
  >([]);

  const flush = (items: { file: File; altText: string }[]) => {
    // The kind is CAPTURED here, at the moment of the decision, not read at
    // upload time — see `start`.
    const withKind = items.map((item) => ({ ...item, kind }));
    if (!eventId) {
      setQueued((current) => [...current, ...withKind]);
      return;
    }
    withKind.forEach((item) => start(item.file, item.altText, item.kind));
  };

  // The id arriving is the signal. `queued` is cleared FIRST so a second
  // render cannot send the same bytes twice — an upload is not idempotent and
  // a duplicated gallery image is a real, visible bug.
  React.useEffect(() => {
    if (!eventId || queued.length === 0) return;
    const batch = queued;
    setQueued([]);
    batch.forEach((item) => start(item.file, item.altText, item.kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, queued.length]);

  const media = content.data?.media ?? [];

  return (
    <div className="flex flex-col gap-block">
      <StepHeader
        title="Media"
      />

      {/* THE COVER AND THE GALLERY ARE DIFFERENT THINGS, so they are different
          sections rather than one grid. `Event.poster_url` is a single column
          that decides how the event looks in every list, every search result
          and every shared link; `EventMedia` rows are the gallery on the event
          page. Merging them into one uploader would mean an organizer who adds
          nine photos still has no card image. */}
      <Section
        title="Cover image"
        count={draft.posterUrl ? 'Set' : 'Not set'}
      >
        <CoverUploader draft={draft} onPoster={onPoster} posterFile={posterFile} />
      </Section>

      {/* ── NO GATE ────────────────────────────────────────────────────
          This used to be replaced by a "unlocks once the draft is saved"
          panel, because gallery images are stored against the event and
          before the first save there is no event to store them against.

          That constraint is real; making it the ORGANISER's problem was the
          mistake. The cover image above has always solved it the other way —
          held on this device, uploaded with the next save — and there was no
          reason the gallery could not do the same. So it does: pick photos,
          describe them, keep working, and they upload themselves the moment
          the draft exists. `flush` below is the whole mechanism.

          ── AND IT IS A LABELLED SECTION LIKE ITS NEIGHBOURS ──────────────
          Cover and Trailer were `Section`s and this -- the longest of the
          three by far -- was a bare fragment, so the step read as
          collapsible / unlabelled sprawl / collapsible. It now carries its
          own heading and count, which also means it can be collapsed once
          the photos are in and the step stops being a single long scroll. */}
      <Section title="Gallery" count={`${media.filter((item) => item.kind !== 'video').length} added`}>
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
              void stage(Array.from(event.dataTransfer.files));
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
            {/* The requirement, before the file picker — not after an
                upload fails. It said "1200×800 or larger works best", which
                described a preference where there is now a rule: the event
                page draws every picture in one 16:9 frame and the server
                refuses anything that cannot fill it. Copy that under-states a
                hard constraint is how somebody uploads eight posters and has
                all eight refused. */}
            <p className="max-w-sm text-caption text-muted-foreground">
              {EVENT_IMAGE_HINT} JPEG, PNG, WebP, AVIF or GIF, up to 10 MB.
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
                void stage(Array.from(event.target.files ?? []));
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
                    flush(
                      staged.map((file, index) => ({
                        file,
                        altText: (altDraft[`${file.name}-${index}`] ?? '').trim(),
                      })),
                    );
                    setStaged([]);
                    setAltDraft({});
                  }}
                >
                  {eventId
                    ? `Upload ${staged.length === 1 ? 'image' : `${staged.length} images`}`
                    : // It genuinely is not uploading yet, so it does not say
                      // it is. The queue below then says when it will.
                      `Add ${staged.length === 1 ? 'image' : `${staged.length} images`}`}
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

          {queued.length ? (
            <section className="flex flex-col gap-stack rounded-xl border border-dashed border-border bg-sunken p-card">
              <h3 className="text-body-sm font-semibold">
                {queued.length === 1 ? '1 image' : `${queued.length} images`} waiting for the
                first save
              </h3>
              <ul className="flex flex-col gap-1">
                {queued.map((item) => (
                  <li key={item.file.name} className="truncate text-caption text-muted-foreground">
                    {KIND_LABEL[item.kind]} · {item.file.name} — {item.altText}
                  </li>
                ))}
              </ul>
              {/* Names the fields, because "save the draft" is not an action
                  anybody can take directly — the wizard saves itself once
                  these exist. */}
              {missingForSave(draft).length ? (
                <div className="flex flex-col gap-1">
                  <p className="text-caption text-muted-foreground">
                    They upload on their own once the draft has:
                  </p>
                  <ul className="flex flex-col gap-1">
                    {missingForSave(draft).map((item) => (
                      <li
                        key={item}
                        className="flex items-center gap-2 text-caption text-muted-foreground"
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-border-strong"
                          aria-hidden
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-caption text-muted-foreground">
                  {save?.state === 'error'
                    ? (save.error ?? 'The last save failed.')
                    : 'Saving now — they go up in a moment.'}
                </p>
              )}
              {/* A queued file lives in this tab's memory: the draft persists
                  to localStorage and a `File` does not survive that. Saying so
                  is the difference between a small window and a surprise. */}
              <p className="text-caption text-muted-foreground">
                They are held in this tab until then — reloading loses them.
              </p>
              <Button
                variant="ghost"
                className="w-fit"
                onClick={() => setQueued([])}
              >
                Clear the queue
              </Button>
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
                      void checkImageFile(row.file).then((problem) => {
                        if (!problem) start(row.file, row.altText);
                        else setStaged((current) => [...current, row.file]);
                      });
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
                body="Photographs from a previous event. Four or five is plenty."
              />
            </div>
          ) : (
            <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
              {media.map((item, index) => (
                <li key={item.id}>
                  <MediaTile
                    media={item}
                    busy={drop.isPending || reorder.isPending}
                    onRemove={() => drop.mutate(item.id)}
                    onMove={(direction) => move(media, index, direction)}
                    onEditAlt={(altText) => editAlt.mutate({ id: item.id, altText })}
                    canMoveUp={index > 0}
                    canMoveDown={index < media.length - 1}
                  />
                </li>
              ))}
            </ul>
          )}
      </Section>

      {eventId ? (
        <Section
          title="Trailer"
          count={media.some((item) => item.kind === 'video') ? 'Added' : 'None'}
        >
          <VideoLink eventId={eventId} media={media} />
        </Section>
      ) : null}

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

  const take = async (candidate: File | undefined) => {
    if (!candidate) return;
    // The same pre-check the gallery uses — type, size AND shape — so a 14 MB
    // cover or a portrait poster is refused here rather than at the end of the
    // next autosave. The cover is the picture the hero frame draws, so if
    // anything has to be 16:9 it is this one.
    const rejected = await checkImageFile(candidate);
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
          void take(event.dataTransfer.files[0]);
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
              <Poster
                url={draft.posterUrl}
                alt="Cover preview"
                className="aspect-card w-full object-cover"
                fallback={
                  <p className="flex aspect-card w-full items-center justify-center bg-muted px-card text-center text-caption text-muted-foreground">
                    This cover could not be loaded. Upload it again.
                  </p>
                }
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
              {EVENT_IMAGE_HINT} It is the picture the event page opens on, so keep faces and text
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
            void take(event.target.files?.[0]);
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
  onMove,
  onEditAlt,
  canMoveUp,
  canMoveDown,
}: {
  media: EventMedia;
  busy: boolean;
  onRemove: () => void;
  /** Swaps this image with its neighbour in the same KIND. Sends the whole
   *  order in one request, so a failure cannot leave it half-applied. */
  onMove: (direction: -1 | 1) => void;
  onEditAlt: (altText: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [armed, setArmed] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draftAlt, setDraftAlt] = React.useState(media.alt_text);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  // Follow the server's value when it changes underneath an idle tile, but
  // never while somebody is typing into it.
  React.useEffect(() => {
    if (!editing) setDraftAlt(media.alt_text);
  }, [media.alt_text, editing]);

  const commitAlt = () => {
    const next = draftAlt.trim();
    setEditing(false);
    // The server REFUSES a blank alt text, so an empty box is a no-op that
    // restores what was there rather than a request that comes back 422.
    if (!next || next === media.alt_text) {
      setDraftAlt(media.alt_text);
      return;
    }
    onEditAlt(next);
  };

  return (
    <figure className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-card w-full bg-muted">
        <Poster
          url={media.url}
          alt={media.alt_text}
          className="size-full object-cover"
          fallback={
            <span className="flex size-full items-center justify-center px-2 text-center text-caption text-muted-foreground">
              Image unavailable
            </span>
          }
        />
        {/* The kind moved out of the caption and onto the picture. A tile was
            four stacked bands -- image, kind, alt, controls -- for what is one
            photograph, and a gallery of them read as a list of cards rather
            than as a gallery. */}
        {media.kind !== 'hero' ? (
          <span className="absolute right-2 top-2 rounded-full bg-overlay/85 px-2 py-0.5 text-caption text-on-gradient backdrop-blur-glass">
            {KIND_LABEL[media.kind]}
          </span>
        ) : null}
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

        {/* Alt text is edited IN PLACE. It used to be fixed at upload, so a
            typo cost a delete and a re-upload of the same bytes — which is
            also how alt text quietly becomes "image1": nobody re-uploads a
            photo to fix a word. */}
        {editing ? (
          <Input
            value={draftAlt}
            autoFocus
            onChange={(event) => setDraftAlt(event.target.value)}
            onBlur={commitAlt}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitAlt();
              if (event.key === 'Escape') {
                setDraftAlt(media.alt_text);
                setEditing(false);
              }
            }}
            aria-label="Alt text"
            className="h-8 text-body-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="line-clamp-2 min-w-0 rounded-sm text-left text-body-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {media.alt_text}
          </button>
        )}

        {/* Armed, Keep comes FIRST. The safe way out is the one under the
            pointer that just pressed the trash icon; the irreversible one is
            the one you have to travel to. */}
        <div className="mt-auto flex items-center justify-end gap-1 pt-stack">
          {/* Up/down rather than drag: the grid is two or three columns at
              different widths, so "up" is not a fixed direction on screen —
              and a drag handle is unusable by keyboard without reimplementing
              the whole interaction. These move within the KIND, because
              position is only meaningful among siblings. */}
          {!armed ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || !canMoveUp}
                onClick={() => onMove(-1)}
                aria-label={`Move ${media.alt_text || 'this image'} earlier`}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || !canMoveDown}
                onClick={() => onMove(1)}
                aria-label={`Move ${media.alt_text || 'this image'} later`}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <span className="flex-1" />
            </>
          ) : null}
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

/**
 * The event's trailer, as a link.
 *
 * ── THE VALIDATION LIVES ON THE SERVER, AND ONLY THERE ────────────────────
 *
 * A pasted URL is normalised there into an embed URL the server BUILDS from an
 * extracted id — the allow-list and the id patterns are the security boundary,
 * and re-implementing them here would be a second copy of a rule that must not
 * drift. So this field posts what was typed and renders whatever sentence
 * comes back, which is written to be shown ("that YouTube link does not
 * contain a video id — use the Share button's link").
 *
 * One video, enforced by the server. With one attached the field is replaced
 * by the row and a Remove, rather than an input that would 422 on submit.
 */
function VideoLink({ eventId, media }: { eventId: string; media: EventMedia[] }) {
  const client = useQueryClient();
  const existing = media.find((item) => item.kind === 'video') ?? null;
  const [url, setUrl] = React.useState('');
  const [altText, setAltText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () => client.invalidateQueries({ queryKey: ['event-content', eventId] });

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      await addMedia(eventId, {
        kind: 'video',
        url: url.trim(),
        // Required by the server for every media row, including this one: a
        // player with no accessible name is an unlabelled region to a screen
        // reader, and "video" is not a description of anything.
        alt_text: altText.trim() || 'Event trailer',
        caption: '',
        position: 0,
      });
      setUrl('');
      setAltText('');
      void invalidate();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await removeMedia(eventId, existing.id);
      void invalidate();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  if (existing) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-card">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-medium">{existing.alt_text}</span>
          <span className="block truncate text-caption text-muted-foreground">{existing.url}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="video-url" className="text-body-sm font-medium">
          Video link
        </label>
        <Input
          id="video-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="video-alt" className="text-body-sm font-medium">
          What it shows <span className="font-normal text-muted-foreground">— optional</span>
        </label>
        <Input
          id="video-alt"
          value={altText}
          maxLength={200}
          onChange={(event) => setAltText(event.target.value)}
          placeholder="Highlights from last year"
        />
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={() => void attach()}
        disabled={!url.trim() || busy}
        loading={busy}
        className="w-fit"
      >
        Add the trailer
      </Button>
    </div>
  );
}
