import { api } from './client';
import { uploadWithProgress, type UploadHandle } from './upload';

/**
 * An organization's crew roster — the people it puts on stage.
 *
 * The roster hangs off the ORGANIZATION because the whole point is reuse: a
 * promoter running the same night monthly adds their resident once and picks
 * them for every event. The lineup hangs off the EVENT, and is written as a
 * whole SET rather than as add/remove pairs — see `setEventCrew`.
 */

export type CrewMember = {
  id: string;
  name: string;
  /** Free text. "DJ", "compere", "sound", "aerialist" — the set is open. */
  role: string;
  details: string;
  photo_url: string;
  photo_alt_text: string;
  /** Retired members stay on the roster and leave the event picker. */
  is_active: boolean;
  created_at: string;
};

const roster = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/crew`;

/**
 * `activeOnly` is what the event wizard's picker asks for.
 *
 * The two lists answer different questions: the management screen has to keep
 * showing a retired member so they can be brought back, and the picker must
 * not offer them for a new event.
 */
export const fetchCrew = (organizationId: string, options?: { activeOnly?: boolean }) =>
  api
    .get<{ data: CrewMember[] }>(
      `${roster(organizationId)}${options?.activeOnly ? '?active_only=true' : ''}`,
    )
    .then((page) => page.data);

export const createCrewMember = (
  organizationId: string,
  input: { name: string; role?: string; details?: string },
) => api.post<CrewMember>(roster(organizationId), input);

export const updateCrewMember = (
  organizationId: string,
  memberId: string,
  changes: Partial<Pick<CrewMember, 'name' | 'role' | 'details' | 'is_active'>>,
) => api.patch<CrewMember>(`${roster(organizationId)}/${encodeURIComponent(memberId)}`, changes);

/**
 * Retire somebody from the roster.
 *
 * REFUSED with a `409 crew_member_in_use` while they appear on any event's
 * lineup — deleting them would empty a section on a page somebody is reading.
 * The message names the alternative (deactivate), so surface it verbatim
 * rather than replacing it with something generic.
 */
export const deleteCrewMember = (organizationId: string, memberId: string) =>
  api.delete<void>(`${roster(organizationId)}/${encodeURIComponent(memberId)}`);

/** Mirrors `core.uploads.CREW_PORTRAIT_SPEC` so the browser refuses what the
 *  server would, before spending somebody's data on the round trip. */
export const CREW_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const CREW_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Attach a portrait.
 *
 * `altText` is REQUIRED — the server refuses without it. That is deliberate
 * and it is why the form collects it BEFORE the bytes go up: text written
 * while looking at the picture is real alt text, where a field appended to a
 * finished grid gets "image1".
 */
export function uploadCrewPhoto(
  organizationId: string,
  memberId: string,
  input: { file: File; altText: string },
  onProgress?: (percent: number) => void,
): UploadHandle<CrewMember> {
  const form = new FormData();
  form.append('file', input.file);
  form.append('alt_text', input.altText);
  return uploadWithProgress<CrewMember>(
    `${roster(organizationId)}/${encodeURIComponent(memberId)}/photo`,
    form,
    onProgress,
  );
}

const photo = (organizationId: string, memberId: string) =>
  `${roster(organizationId)}/${encodeURIComponent(memberId)}/photo`;

/**
 * Correct a portrait's description without re-uploading it.
 *
 * The alt text is collected before the bytes go up, which is the right order —
 * and the cost of that order was that a typo could only be fixed by choosing
 * the file again. `photo_alt_text` is `read_only` on the member serializer, so
 * `updateCrewMember` cannot touch it; this is the path.
 *
 * Refused with a `400` when the member has no photo: a description of an image
 * nobody can see is a row that lies, and the next upload would overwrite it.
 */
export const describeCrewPhoto = (organizationId: string, memberId: string, altText: string) =>
  api.patch<CrewMember>(photo(organizationId, memberId), { alt_text: altText });

/**
 * Take the portrait off a roster row.
 *
 * Answers with the UPDATED MEMBER rather than 204, so the card re-renders as
 * initials from what the call already returned instead of re-reading the
 * roster to discover what it just caused.
 *
 * Idempotent — a member with no photo comes back unchanged, so a double-press
 * or a second open tab is not an error. Note this clears the ROW, not the
 * stored object: every image path in this codebase leaves its old object
 * behind (the keys carry a uuid, so nothing is overwritten in place), and
 * bucket lifecycle is the honest place to reap them.
 */
export const removeCrewPhoto = (organizationId: string, memberId: string) =>
  api.delete<CrewMember>(photo(organizationId, memberId));

export type EventCrewEntry = {
  id: string;
  name: string;
  role: string;
  photo_url: string;
  photo_alt_text: string;
  position: number;
};

export const fetchEventCrew = (eventId: string) =>
  api
    .get<{ data: EventCrewEntry[] }>(`/events/${encodeURIComponent(eventId)}/crew`)
    .then((page) => page.data);

/**
 * Set an event's whole lineup, in order.
 *
 * A PUT of the WHOLE SET, not add/remove calls. The control upstream is a
 * multi-select: somebody manipulates a set and presses save once. Diffing that
 * into per-row requests in the browser would make the network the source of
 * truth for what was chosen, and one dropped request would leave a lineup
 * nobody had asked for.
 *
 * The order of `memberIds` IS the order on the public page — an alphabetical
 * lineup would put the support act above the headliner.
 */
export const setEventCrew = (eventId: string, memberIds: string[]) =>
  api
    .put<{ data: EventCrewEntry[] }>(`/events/${encodeURIComponent(eventId)}/crew`, {
      member_ids: memberIds,
    })
    .then((page) => page.data);
