'use client';

import * as React from 'react';

/**
 * Saved events — local first, and account-backed once you sign in.
 *
 * ── WHY THE LOCAL STORE IS STILL THE SOURCE OF TRUTH FOR THE UI ──────────
 *
 * Browsing needs no account, and a heart that demands one before it will fill
 * removes the affordance for exactly the people still deciding whether to make
 * an account. So a save always lands in `localStorage` FIRST and the UI
 * updates immediately — no spinner on a heart, no round trip before the colour
 * changes.
 *
 * When somebody is signed in, a REMOTE ADAPTER (registered once by
 * `FavouritesSync`) mirrors each change to `events.SavedEvent`, and the whole
 * local set is merged into their account at sign-in. A failed write rolls the
 * local change back, so the heart never shows a state the server disagrees
 * with.
 *
 * The store itself knows nothing about React Query, auth or fetch — it takes
 * an adapter. That keeps "what is saved" answerable synchronously from one
 * place, which is what lets every card on a grid stay in agreement without
 * each one holding a subscription to a request.
 *
 * A `storage`-event listener keeps two tabs in agreement, and a module-level
 * subscriber set keeps every card on the page in agreement without each one
 * re-reading storage.
 */

const STORAGE_KEY = 'ee-saved-events';

const subscribers = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    cache = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * Mirrors changes to the signed-in user's account. Null while anonymous.
 *
 * Module-level rather than context, because `write` is a plain function called
 * from a callback — threading a context through it would mean every caller
 * holding a hook it does not otherwise need.
 */
type RemoteSync = {
  save: (eventId: string) => Promise<unknown>;
  unsave: (eventId: string) => Promise<unknown>;
};

let remote: RemoteSync | null = null;

export function setRemoteSync(adapter: RemoteSync | null) {
  remote = adapter;
}

/** Replace the local set outright — used after a sign-in merge. */
export function replaceSavedEventIds(ids: string[]) {
  write(ids);
}

export function readSavedEventIds(): string[] {
  return read();
}

function write(ids: string[]) {
  cache = ids;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked — the choice still applies for this session */
  }
  subscribers.forEach((notify) => notify());
}

/**
 * Every saved id, subscribed to the same store `useIsSaved` writes.
 *
 * Returns `null` until the first client read, so a caller can tell "not known
 * yet" from "genuinely empty" — the server has no localStorage, and rendering
 * an empty state during hydration then filling it in is a visible flash on the
 * one screen whose whole job is to list what you saved.
 */
export function useSavedEventIds(): string[] | null {
  const [ids, setIds] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    const sync = () => setIds(read());
    sync();
    subscribers.add(sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      cache = null;
      sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      subscribers.delete(sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return ids;
}

export function useIsSaved(eventId: string) {
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setSaved(read().includes(eventId));
    sync();
    subscribers.add(sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      cache = null;
      sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      subscribers.delete(sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [eventId]);

  const toggle = React.useCallback(() => {
    const before = read();
    const wasSaved = before.includes(eventId);
    const after = wasSaved ? before.filter((id) => id !== eventId) : [...before, eventId];

    // Optimistic: the heart fills now, not after a round trip.
    write(after);

    if (!remote) return;
    const request = wasSaved ? remote.unsave(eventId) : remote.save(eventId);
    void request.catch(() => {
      // ROLL BACK to what was actually there, not to the inverse of `after` —
      // another card or tab may have changed the set while the request was in
      // flight, and blindly inverting would clobber that.
      const current = read();
      write(
        wasSaved
          ? [...new Set([...current, eventId])]
          : current.filter((id) => id !== eventId),
      );
    });
  }, [eventId]);

  return { saved, toggle };
}
