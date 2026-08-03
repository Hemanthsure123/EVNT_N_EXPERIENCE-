'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveEvents, unsaveEvent } from '@/lib/api/saved-events';
import {
  readSavedEventIds,
  replaceSavedEventIds,
  setRemoteSync,
} from '@/lib/discovery/use-favourites';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * Connects the device-local saved set to the signed-in user's account.
 *
 * Mounted ONCE, renders nothing. It does two things:
 *
 *  1. **Registers the write-through adapter** while authenticated, so every
 *     subsequent toggle mirrors to the server. Clears it on sign-out, which is
 *     what stops one person's saves being written to the previous user's
 *     account on a shared device.
 *
 *  2. **Merges on sign-in.** Everything saved while logged out is handed over
 *     in one call, and the server's full set replaces the local one. The merge
 *     is idempotent, so re-running it costs nothing.
 *
 * ── WHY THE SERVER'S ANSWER REPLACES THE LOCAL SET, NOT THE OTHER WAY ───
 *
 * After the merge the account holds the union of both, so the response is
 * strictly more complete than what the browser had — and it is the set that
 * follows the user to their next device. Keeping the local one would silently
 * drop saves made on another device.
 */
export function FavouritesSync() {
  const { status, user } = useAuth();
  const client = useQueryClient();
  // Keyed by user id so switching accounts on one device re-runs the merge
  // rather than assuming the previous person's set is this person's.
  const mergedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (status !== 'authenticated' || !user) {
      setRemoteSync(null);
      mergedFor.current = null;
      return;
    }

    // Each mirrored write drops the account list, so unsaving something from
    // the Saved page removes the card instead of leaving it there until the
    // next navigation. The rejection is passed THROUGH — the store's rollback
    // depends on seeing it.
    const mirror = <T,>(request: Promise<T>): Promise<T> =>
      request.then((value) => {
        void client.invalidateQueries({ queryKey: ['saved-events'] });
        return value;
      });

    setRemoteSync({
      save: (eventId) => mirror(saveEvents([eventId])),
      unsave: (eventId) => mirror(unsaveEvent(eventId)),
    });

    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;

    void saveEvents(readSavedEventIds())
      .then((ids) => {
        replaceSavedEventIds(ids);
        void client.invalidateQueries({ queryKey: ['saved-events'] });
      })
      .catch(() => {
        // A failed merge leaves the local set intact and the adapter live, so
        // the next toggle still reaches the server. Nothing is lost, and the
        // next sign-in tries again — which is worth more than an error toast
        // about a background sync nobody asked for.
      });
  }, [client, status, user]);

  return null;
}
