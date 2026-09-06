import { EVENT_IMAGE, EVENT_PORTRAIT, type MediaKind } from '@/lib/api/event-content';

/**
 * What each image slot on an event is FOR, and what shape it has to be.
 *
 * ── THE ONE THING THIS FILE EXISTS TO FIX ─────────────────────────────────
 *
 * The media step used to ask for a `MediaKind` from a dropdown labelled
 * "Uploading as", with one dropzone underneath it and one sentence about
 * shape for all of them. So an organiser chose between five words — Hero
 * banner, Gallery, Thumbnail, Mobile banner, Video — with nothing on screen
 * saying what any of them appears as, how many are allowed, or which one is
 * the picture people actually see. The commonest outcomes were a gallery of
 * nine photographs and no hero, or a hero uploaded four times because the
 * refusal did not say the slot was already full.
 *
 * A zone per slot answers all three questions before the file picker opens:
 * what it is, what shape it has to be, and how many are left.
 *
 * ── THE MOBILE SLOT IS PORTRAIT NOW, AND THAT IS A BACKEND CHANGE ─────────
 *
 * This paragraph used to explain why a "portrait poster (3:4)" zone could not
 * be built: `upload_media` called `validate_image(upload, spec=
 * EVENT_IMAGE_SPEC)` for EVERY kind, so a zone captioned "portrait" would have
 * been a dropzone in which every upload was refused by the server, with a
 * message contradicting the label above it.
 *
 * That precondition is met. `MEDIA_SPECS` in `apps/events/repositories.py`
 * maps `mobile` to `EVENT_PORTRAIT_SPEC`, and `SHAPE_FOR_KIND` in
 * `lib/api/event-content.ts` mirrors it so the browser pre-check agrees. The
 * band accepts 2:3 through 3:4 — the two shapes organisers actually have —
 * rather than the single ratio the brief names.
 *
 * The rule the old paragraph was really stating still holds and is worth
 * keeping: NOTHING IN THIS FILE INVENTS A SHAPE THE API WILL NOT TAKE. Every
 * `targetRatio` here is inside its kind's server spec, and `media-zones.test`
 * checks each zone against the spec for ITS OWN kind rather than against one
 * shared band.
 *
 * ── THE CAPS: WHICH ARE RULES AND WHICH ARE ADVICE ────────────────────────
 *
 * `serverCap` mirrors `MEDIA_LIMITS` in `apps/events/repositories.py`, which
 * `EventContentService._require_media_slot` enforces on add, upload AND a
 * PATCH that moves a row between kinds. Those are rules.
 *
 * `uiCap` is what this step offers. For the gallery it is deliberately LOWER
 * than the server's (3 against 10), because three photographs is a gallery and
 * ten is a scroll — and because that is a product judgement, it is advice:
 * the zone stops offering the picker at three and says why, but an event that
 * already holds four renders all four, keeps them editable, and is never
 * silently trimmed. A guideline that deletes rows is not a guideline.
 */

export type ImageZone = {
  kind: Exclude<MediaKind, 'video'>;
  title: string;
  /** What this picture does on the public page. One clause, not a paragraph. */
  purpose: string;
  /** The frame this slot is drawn in, as width / height. */
  targetRatio: number;
  /** The same ratio as somebody would type it into an export dialog. */
  targetLabel: string;
  /** `MEDIA_LIMITS` — enforced by the API. */
  serverCap: number;
  /** What this step offers. Equal to `serverCap` unless it is a judgement. */
  uiCap: number;
  /** True when `uiCap` is a product judgement rather than the API's rule, so
   *  the UI can say "recommended" instead of implying a refusal. */
  capIsGuideline: boolean;
  /** Warn once the files held for this zone add up to this. Absent means the
   *  zone holds one image, where a per-file limit is the only one that means
   *  anything. */
  combinedWarnBytes?: number;
};

/** 16:9 — the shape `EVENT_IMAGE_SPEC` recommends and the event page draws. */
const SIXTEEN_NINE = EVENT_IMAGE.recommendedWidth / EVENT_IMAGE.recommendedHeight;
/** DERIVED from the spec, like the one above it — a literal 0.75 here and a
 *  changed recommendation there is how the label and the gate drift apart. */
const THREE_FOUR = EVENT_PORTRAIT.recommendedWidth / EVENT_PORTRAIT.recommendedHeight;

/**
 * How large a gallery may get before this step says something.
 *
 * NOT a server limit — `core.uploads.MAX_IMAGE_BYTES` is 10 MB PER FILE and
 * there is no combined cap anywhere in the API. This is about the two things
 * that do bite: a phone upload of five large photographs over hotel wifi, and
 * an event page that fetches all of them. Which is why it is a sentence and
 * never a refusal.
 */
export const GALLERY_COMBINED_WARN_BYTES = 5 * 1024 * 1024;

/** Three photographs is a gallery. See the note on `uiCap` above. */
export const GALLERY_UI_CAP = 3;

export const IMAGE_ZONES: readonly ImageZone[] = [
  {
    kind: 'hero',
    title: 'Landscape poster',
    purpose: 'The wide artwork at the top of the event page and on every shared link.',
    targetRatio: SIXTEEN_NINE,
    targetLabel: '16:9',
    serverCap: 1,
    uiCap: 1,
    capIsGuideline: false,
  },
  {
    kind: 'mobile',
    title: 'Portrait poster',
    purpose:
      'The picture people see first on a phone, where the card is taller than it is wide.',
    targetRatio: THREE_FOUR,
    targetLabel: '3:4',
    serverCap: 1,
    uiCap: 1,
    capIsGuideline: false,
  },
  {
    kind: 'thumbnail',
    title: 'Thumbnail',
    purpose: 'A smaller crop for compact lists and related-event rows.',
    targetRatio: SIXTEEN_NINE,
    targetLabel: '16:9',
    serverCap: 1,
    uiCap: 1,
    capIsGuideline: false,
  },
  {
    kind: 'gallery',
    title: 'Gallery photos',
    purpose: 'Photographs of the room, the stage or a previous edition.',
    targetRatio: SIXTEEN_NINE,
    targetLabel: '16:9',
    serverCap: 10,
    uiCap: GALLERY_UI_CAP,
    capIsGuideline: true,
    combinedWarnBytes: GALLERY_COMBINED_WARN_BYTES,
  },
];

/** Every kind's zone, so a row of an unexpected kind still lands somewhere. */
export function zoneFor(kind: MediaKind): ImageZone | null {
  return IMAGE_ZONES.find((zone) => zone.kind === kind) ?? null;
}

/**
 * The pixel size of a picked file.
 *
 * ── WHY THIS MEASURES AGAIN ───────────────────────────────────────────────
 *
 * `checkImageFile` already decodes the header to enforce the server's band,
 * but its `readDimensions` is module-private to `lib/api/event-content.ts` and
 * it returns only a message. Exporting it belongs in that file, which this
 * change does not own — so this reads the header a second time, for files that
 * have ALREADY passed. The cost is one header parse per accepted file, off the
 * main thread; the alternative is a second copy of the SHAPE RULE, which is
 * the thing that must never be duplicated.
 *
 * Returns `null` when the browser cannot measure it (Safari below 17 for some
 * types). Silence is right there: an advisory that cannot be computed is not
 * an advisory worth guessing at.
 */
export async function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Below this the crop is not worth a sentence. A 3:2 photograph in a 16:9
 *  frame loses 11%, which is; 1920x1081 loses 0.1%, which is not. */
const CROP_TOLERANCE = 0.08;

/**
 * What this file will lose to the zone's frame, if enough to mention.
 *
 * Every file that reaches here has already passed `checkImageFile`, so it is
 * inside the server's 1.5–2.0 band — this is the remaining, allowed variation
 * INSIDE that band, which the event page still resolves by cropping. The
 * percentage is measured, not estimated: it is the fraction of the picture the
 * fixed frame cannot show.
 *
 * It is a WARNING and says so. The upload goes ahead — refusing a file the
 * server accepts would be this step overruling the API on a judgement about
 * somebody else's artwork.
 */
export function cropAdvice(
  file: File,
  size: { width: number; height: number },
  zone: ImageZone,
): string | null {
  const ratio = size.width / size.height;
  const overWide = ratio > zone.targetRatio;
  const lost = overWide ? 1 - zone.targetRatio / ratio : 1 - ratio / zone.targetRatio;
  if (!Number.isFinite(lost) || lost < CROP_TOLERANCE) return null;
  const percent = Math.round(lost * 100);
  const edges = overWide ? 'the left and right' : 'the top and bottom';
  return `${file.name} is ${size.width} × ${size.height}. The ${zone.title.toLowerCase()} is drawn at ${zone.targetLabel}, so roughly ${percent}% will be cropped off ${edges}. It will still upload — ${EVENT_IMAGE.recommendedWidth} × ${EVENT_IMAGE.recommendedHeight} fits exactly.`;
}

/**
 * Whether the files this browser is holding for a zone are getting heavy.
 *
 * ── IT COUNTS ONLY WHAT THE BROWSER HAS ───────────────────────────────────
 *
 * Staged, queued and in-flight files — never the rows already on the server.
 * `EventMedia` carries `id`, `kind`, `url`, `alt_text`, `caption` and
 * `position`, and no byte size, so a total that included them would be a
 * number nobody computed presented as a measurement. Better a smaller true
 * total than a larger invented one; the sentence says which files it means.
 */
export function combinedSizeNote(bytes: number, count: number, limit: number): string | null {
  if (count === 0 || bytes < limit * 0.8) return null;
  const megabytes = (bytes / (1024 * 1024)).toFixed(1);
  const limitMegabytes = Math.round(limit / (1024 * 1024));
  const these = count === 1 ? 'This photo is' : `These ${count} photos come to`;
  return bytes >= limit
    ? `${these} ${megabytes} MB. Each one is inside the 10 MB the server allows, but together they are a slow upload on a phone — and the event page loads all of them.`
    : `${these} ${megabytes} MB, close to the ${limitMegabytes} MB this step suggests keeping a gallery under.`;
}
