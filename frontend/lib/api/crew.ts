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
