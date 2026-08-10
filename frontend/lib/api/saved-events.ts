import { api } from './client';

/**
 * Saved events on the signed-in user's account.
 *
 * The browser saves locally first and mirrors here — see
 * `lib/discovery/use-favourites.ts` for why the local store stays the source
 * of truth for the UI.
 */

export type SavedEventCard = {
  saved_at: string;
  id: string;
  title: string;
  venue: string;
  city: string;
  /** Same column the browse card reads. Blank = not categorised. */
  category: string;
  starts_at: string;
  poster_url: string;
  from_price: number | null;
  tickets_available: number | null;
  organization_id: string;
  organization_name: string;
  /** False once the event is cancelled or past. The card says so rather than
      offering a dead Book button — hiding it would look like the save was
      lost. */
  is_available: boolean;
};

export const fetchSavedEvents = () =>
  api.get<{ data: SavedEventCard[] }>('/me/saved-events').then((body) => body.data);

/**
 * Save one or many, returning the FULL set of saved ids.
 *
 * Takes a list because the sign-in merge hands over everything the browser
 * accumulated while logged out, and returns the whole set so the client can
 * replace its local state outright instead of reconciling.
 */
export const saveEvents = (eventIds: string[]) =>
  api
    .post<{ event_ids: string[] }>('/me/saved-events', { event_ids: eventIds })
    .then((body) => body.event_ids);

export const unsaveEvent = (eventId: string) =>
  api.delete<void>(`/me/saved-events/${encodeURIComponent(eventId)}`);
