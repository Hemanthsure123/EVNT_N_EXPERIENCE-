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
  EVENT_IMAGE,
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
import { ErrorState, Skeleton } from '@/components/organizer/primitives';
import { Button, Input } from '@/components/ui';
import type { Draft } from '@/lib/organizer/wizard/model';
import { cn } from '@/lib/utils/cn';
import { Section, StepHeader, type DraftSave } from './fields';
import { missingForSave } from './details-step';
import {
  IMAGE_ZONES,
  combinedSizeNote,
  cropAdvice,
  measureImage,
  zoneFor,
  type ImageZone,
} from './media-zones';
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

/**
 * One file waiting for its alt text.
 *
 * It carries its own `kind` now. It used to be a bare `File` plus a single
 * `kind` held in step state, which meant the kind was read at FLUSH time — so
 * a batch described while the selector said "Gallery" and uploaded after it
 * had been changed went up as something else. Zones removed the selector, and
 * the kind travels with the file from the moment it is dropped.
 */
type Staged = {
  key: string;
  file: File;
  kind: ImageZone['kind'];
  /** A measured crop advisory, computed once at drop time. Null when the
   *  picture fits the zone's frame, or when the browser could not measure it. */
  note: string | null;
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
  const [staged, setStaged] = React.useState<Staged[]>([]);
  const [altDraft, setAltDraft] = React.useState<Record<string, string>>({});

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
   *
   * The list it is HANDED is now the zone's own — one kind — where it used to
   * be every row on the event. That was a real defect the zones removed: the
   * renumbering ran across kinds, so moving one gallery photo rewrote the
   * hero's position too, and a video row sat in the image grid drawing a
   * broken tile because its `url` is a YouTube embed, not a picture.
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
  //
  // It lands in the GALLERY, because a paste has no zone under the cursor to
  // read and the gallery is where several images at once belong. The gallery's
  // own dropzone is the only one that mentions ⌘V, so the destination is
  // stated where somebody would look for it rather than guessed at.
  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) void stage(files, 'gallery');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Async now, because measuring a picture means decoding its header. The
  // await is per-file and off the main thread; a dozen dropped files resolve
  // in a few milliseconds, and the alternative is finding out after the bytes
  // have already gone up.
  const stage = async (files: File[], forKind: ImageZone['kind']) => {
    const zone = zoneFor(forKind);
    const accepted: Staged[] = [];
    const rejected: Pending[] = [];
    for (const file of files) {
      // The SERVER's rule, mirrored: type, size, then shape against
      // `EVENT_IMAGE_SPEC`. Everything below this line is advice.
      const problem = await checkImageFile(file);
      if (problem) {
        // Rejected client-side, but shown as a failed tile rather than a toast
        // — the organizer needs to see WHICH file was refused.
        rejected.push({
          key: `${file.name}-${Math.random()}`,
          file,
          kind: forKind,
          altText: '',
          percent: 0,
          error: problem,
          handle: null,
        });
        continue;
      }
      const size = zone ? await measureImage(file) : null;
      accepted.push({
        key: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        kind: forKind,
        note: zone && size ? cropAdvice(file, size, zone) : null,
      });
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

  const start = (file: File, altText: string, forKind: MediaKind) => {
    // `forKind` is passed rather than read off state, because a QUEUED file is
    // uploaded later — possibly long after it was described. Reading a shared
    // selector at flush time would file a gallery photo as the hero, silently,
    // and the hero is the card image on every list on the platform.
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

  const flush = (items: { file: File; altText: string; kind: MediaKind }[]) => {
    if (!eventId) {
      setQueued((current) => [...current, ...items]);
      return;
    }
    items.forEach((item) => start(item.file, item.altText, item.kind));
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

  /** Hand a zone's described files to the uploader and clear its staging. */
  const uploadZone = (forKind: ImageZone['kind']) => {
    const rows = staged.filter((row) => row.kind === forKind);
    flush(
      rows.map((row) => ({
        file: row.file,
        altText: (altDraft[row.key] ?? '').trim(),
        kind: row.kind,
      })),
    );
    forget(rows);
  };

  const forget = (rows: Staged[]) => {
    const keys = new Set(rows.map((row) => row.key));
    setStaged((current) => current.filter((row) => !keys.has(row.key)));
    setAltDraft((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const media = content.data?.media ?? [];
  /**
   * Rows whose kind has no zone.
   *
   * Empty against today's `MediaKind` union — every non-video kind has a zone
   * — and rendered anyway, because the union is a description of what the API
   * returned when this was written. If a kind is added server-side, its rows
   * must show up somewhere an organiser can delete them, not silently
   * disappear from a step whose whole job is showing what the event holds.
   */
  const unzoned = media.filter((item) => item.kind !== 'video' && !zoneFor(item.kind));

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

      {/* ── ONE ZONE PER SLOT, INSTEAD OF ONE DROPZONE AND A DROPDOWN ─────
          Every zone states what its picture is for, the shape it has to be and
          how many are left BEFORE the file picker opens. That is the whole
          change: the machinery underneath — drag and drop, paste, alt text
          before the bytes, real progress, cancel, retry, reorder, in-place alt
          editing — is the same code it was, wired per zone instead of through a
          shared `kind` selector.

          ── NO GATE ────────────────────────────────────────────────────
          Gallery images are stored against the event, and before the first
          save there is no event to store them against. That constraint is
          real; making it the ORGANISER's problem was the mistake. The cover
          image has always solved it the other way — held on this device,
          uploaded with the next save — so these do the same: pick photos,
          describe them, keep working, and they upload themselves the moment
          the draft exists. `flush` above is the whole mechanism. */}
      {content.isError ? (
        <ErrorState
          message="Could not load this event's media."
          onRetry={() => void content.refetch()}
          className="rounded-xl border border-border bg-surface shadow-sm"
        />
      ) : null}

      {IMAGE_ZONES.map((zone) => {
        const rows = media.filter((item) => item.kind === zone.kind);
        const zoneStaged = staged.filter((row) => row.kind === zone.kind);
        const zonePending = pending.filter((row) => row.kind === zone.kind);
        const zoneQueued = queued.filter((item) => item.kind === zone.kind);
        // Everything that has claimed a slot, wherever it is on its way there.
        // A failed pending tile does NOT count: its bytes never reached the
        // server, so counting it would lock somebody out of a slot that is
        // demonstrably free.
        const filled =
          rows.length +
          zoneStaged.length +
          zoneQueued.length +
          zonePending.filter((row) => !row.error).length;
        const full = filled >= zone.uiCap;
        // Only the files this browser is holding — see `combinedSizeNote`.
        const heldBytes = [
          ...zoneStaged.map((row) => row.file.size),
          ...zoneQueued.map((item) => item.file.size),
          ...zonePending.filter((row) => !row.error).map((row) => row.file.size),
        ];
        const sizeNote = zone.combinedWarnBytes
          ? combinedSizeNote(
              heldBytes.reduce((sum, size) => sum + size, 0),
              heldBytes.length,
              zone.combinedWarnBytes,
            )
          : null;

        return (
          <ZoneFrame key={zone.kind} zone={zone} filled={filled}>
            {full ? (
              <p className="rounded-lg border border-dashed border-border bg-sunken px-card py-stack text-caption text-muted-foreground">
                {/* WHY it is full and HOW to free it, in one line. A zone that
                    just hides its picker is a zone somebody presses ⌘V at and
                    concludes is broken. */}
                {zone.capIsGuideline
                  ? `${zone.uiCap} is the number this step recommends. Remove one to add another.`
                  : `This event already has its ${zone.title.toLowerCase()}. Remove it to upload a different one.`}
              </p>
            ) : (
              <ZoneDropzone zone={zone} onFiles={(files) => void stage(files, zone.kind)} />
            )}

            {sizeNote ? (
              <p className="text-caption text-warning-subtle-foreground">{sizeNote}</p>
            ) : null}

            {/* Alt text is collected BEFORE the bytes go up — the server refuses
                a file without it, and text written with the image in mind is
                real alt text rather than "image1". */}
            {zoneStaged.length ? (
              <section className="flex flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm">
                <h3 className="text-body-sm font-semibold">
                  Describe {zoneStaged.length === 1 ? 'this image' : 'these images'} before
                  uploading
                </h3>
                <ul className="flex flex-col gap-stack">
                  {zoneStaged.map((row) => (
                    <li key={row.key} className="flex flex-col gap-1.5">
                      <label htmlFor={`alt-${row.key}`} className="truncate text-caption font-medium">
                        {row.file.name}
                      </label>
                      <Input
                        id={`alt-${row.key}`}
                        value={altDraft[row.key] ?? ''}
                        onChange={(event) =>
                          setAltDraft((current) => ({ ...current, [row.key]: event.target.value }))
                        }
                        placeholder="What is in the picture? e.g. The main stage at dusk, crowd in front"
                      />
                      {/* Measured, not guessed, and explicitly not a refusal —
                          the server takes this file. See `cropAdvice`. */}
                      {row.note ? (
                        <p className="text-caption text-warning-subtle-foreground">{row.note}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-stack">
                  <Button
                    variant="outline"
                    disabled={zoneStaged.some((row) => !(altDraft[row.key] ?? '').trim())}
                    onClick={() => uploadZone(zone.kind)}
                  >
                    {eventId
                      ? `Upload ${zoneStaged.length === 1 ? 'image' : `${zoneStaged.length} images`}`
                      : // It genuinely is not uploading yet, so it does not say
                        // it is. The queue below then says when it will.
                        `Add ${zoneStaged.length === 1 ? 'image' : `${zoneStaged.length} images`}`}
                  </Button>
                  <Button variant="ghost" onClick={() => forget(zoneStaged)}>
                    Cancel
                  </Button>
                </div>
              </section>
            ) : null}

            {zoneQueued.length ? (
              <section className="flex flex-col gap-stack rounded-xl border border-dashed border-border bg-sunken p-card">
                <h3 className="text-body-sm font-semibold">
                  {zoneQueued.length === 1 ? '1 image' : `${zoneQueued.length} images`} waiting for
                  the first save
                </h3>
                <ul className="flex flex-col gap-1">
                  {zoneQueued.map((item) => (
                    <li key={item.file.name} className="truncate text-caption text-muted-foreground">
                      {item.file.name} — {item.altText}
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
                  onClick={() =>
                    setQueued((current) => current.filter((item) => item.kind !== zone.kind))
                  }
                >
                  Clear the queue
                </Button>
              </section>
            ) : null}

            {zonePending.length ? (
              <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
                {zonePending.map((row) => (
                  <li key={row.key}>
                    <PendingTile
                      row={row}
                      onCancel={() => {
                        row.handle?.cancel();
                        setPending((current) => current.filter((item) => item.key !== row.key));
                      }}
                      onRetry={() => {
                        setPending((current) => current.filter((item) => item.key !== row.key));
                        // Re-checked, not re-sent blind: the file may have been
                        // refused for its shape. `zone.kind` rather than
                        // `row.kind` only because this list is already filtered
                        // to it — a retry cannot land in another zone either way.
                        void stage([row.file], zone.kind);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {eventId && content.isPending ? (
              <Skeleton className="aspect-card w-full max-w-xs rounded-xl" />
            ) : rows.length ? (
              <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
                {rows.map((item, index) => (
                  <li key={item.id}>
                    <MediaTile
                      media={item}
                      busy={drop.isPending || reorder.isPending}
                      onRemove={() => drop.mutate(item.id)}
                      onMove={(direction) => move(rows, index, direction)}
                      onEditAlt={(altText) => editAlt.mutate({ id: item.id, altText })}
                      canMoveUp={index > 0}
                      canMoveDown={index < rows.length - 1}
                      // Redundant inside a zone that is already named after the
                      // kind — the badge exists for the fallback section below.
                      showKind={false}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </ZoneFrame>
        );
      })}

      {unzoned.length ? (
        <Section title="Other images" count={`${unzoned.length}`}>
          <ul className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
            {unzoned.map((item) => (
              <li key={item.id}>
                <MediaTile
                  media={item}
                  busy={drop.isPending}
                  onRemove={() => drop.mutate(item.id)}
                  onMove={() => undefined}
                  onEditAlt={(altText) => editAlt.mutate({ id: item.id, altText })}
                  canMoveUp={false}
                  canMoveDown={false}
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {eventId ? (
        <Section
          title="Video"
          count={media.some((item) => item.kind === 'video') ? 'Added' : 'None'}
        >
          <VideoLink eventId={eventId} media={media} />
        </Section>
      ) : null}

    </div>
  );
}

/**
 * A zone's frame: what this picture is for, the shape it has to be, and how
 * many slots are left.
 *
 * The requirement line is not decoration. `EVENT_IMAGE_SPEC` refuses anything
 * outside 1.5:1–2:1 at 1280x720 or better, and the commonest wrong upload is a
 * portrait poster somebody spent money on — so the rule is stated at the top of
 * the zone, before the picker, rather than delivered as a refusal after the
 * bytes have gone up over a phone connection.
 *
 * The count reads "1 of 3" and turns to the muted state at the cap rather than
 * a red one: being full is a normal state of a finished zone, not a fault.
 */
function ZoneFrame({
  zone,
  filled,
  children,
}: {
  zone: ImageZone;
  filled: number;
  children: React.ReactNode;
}) {
  return (
    // A `Section`, like Cover image beside it — so a finished zone can be
    // folded away and the step stops being one long scroll now that there are
    // four of them. The count is on the summary, which means a collapsed zone
    // still says what is in it.
    //
    // `{filled} of {cap}` and, for the gallery, the WORD that separates a rule
    // from a judgement: 3 is this step's opinion and the API takes 10, so an
    // organiser who genuinely needs a fourth should be able to tell which of
    // those they are arguing with.
    <Section
      title={zone.title}
      count={`${filled} of ${zone.uiCap}${zone.capIsGuideline ? ' recommended' : ''}`}
    >
      <div className="flex flex-col gap-1">
        <p className="max-w-prose text-body-sm text-muted-foreground">{zone.purpose}</p>
        {/* The requirement, BEFORE the picker rather than as a refusal after
            the bytes have gone up over a phone connection.
            `EVENT_IMAGE_SPEC` refuses anything outside 1.5:1–2:1 at 1280x720
            or better, and the commonest wrong upload is a portrait poster
            somebody has paid a designer for. */}
        <p className="text-caption text-muted-foreground">
          Landscape {zone.targetLabel} · {EVENT_IMAGE.recommendedWidth} ×{' '}
          {EVENT_IMAGE.recommendedHeight} ideal, {EVENT_IMAGE.minWidth} × {EVENT_IMAGE.minHeight}{' '}
          minimum · JPEG, PNG, WebP, AVIF or GIF up to 10 MB
        </p>
      </div>
      {children}
    </Section>
  );
}

/** A zone's own dropzone. Its own `over` state and its own file input, so two
 *  zones cannot arm each other and a drop always lands in the zone under the
 *  cursor rather than in whatever a shared selector last said. */
function ZoneDropzone({ zone, onFiles }: { zone: ImageZone; onFiles: (files: File[]) => void }) {
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const many = zone.uiCap > 1;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles(Array.from(event.dataTransfer.files));
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
      <p className="text-body-sm font-medium">
        {/* ⌘V is named on the gallery only, because that is where a paste
            lands — see the paste effect. Promising it on a zone it does not
            reach would be worse than not mentioning it. */}
        {many ? 'Drop images here, or paste with ⌘V' : `Drop the ${zone.title.toLowerCase()} here`}
      </p>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        {many ? 'Choose files' : 'Choose a file'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={many}
        className="sr-only"
        aria-label={`Choose ${many ? 'images' : 'an image'} for ${zone.title}`}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
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
  showKind = true,
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
  /** Off inside a zone, which is already named after the kind — a "Gallery"
   *  pill on every tile in a section headed Gallery is ink that says nothing.
   *  On by default, so the fallback section for an unrecognised kind still
   *  tells an organiser what they are looking at. */
  showKind?: boolean;
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
        {showKind && media.kind !== 'hero' ? (
          <span className="absolute right-2 top-2 rounded-full bg-overlay/85 px-2 py-0.5 text-caption text-on-gradient backdrop-blur-glass">
            {/* A kind the union does not know still names itself, rather than
                drawing the word "undefined" over somebody's photograph. */}
            {KIND_LABEL[media.kind] ?? media.kind}
          </span>
        ) : null}
        {showKind && media.kind === 'hero' ? (
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
