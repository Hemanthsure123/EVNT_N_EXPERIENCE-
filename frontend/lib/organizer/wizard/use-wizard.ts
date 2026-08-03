'use client';

import * as React from 'react';
import { ApiError } from '@/lib/api/errors';
import {
  createEvent,
  createTicketType,
  publishEvent,
  updateEvent,
  updateTicketType,
  uploadPoster,
} from '@/lib/api/organizer-writes';
import {
  canCreate,
  discardLegacyDraft,
  draftStorageKey,
  emptyDraft,
  patchFingerprint,
  resolveOrganizationId,
  restoreDraft,
  tierFingerprint,
  toCreateInput,
  toPatchInput,
  toTierInput,
  type Draft,
  type DraftTier,
} from './model';

/**
 * The wizard's engine: local-first draft, autosave, undo/redo.
 *
 * ── WHY LOCAL-FIRST ───────────────────────────────────────────────────────
 *
 * `POST /events` requires title, venue, city AND a future start time all at
 * once — there is no "create an empty draft" endpoint. So the wizard cannot
 * put anything on the server until step 3 is done, and everything typed before
 * that would be lost to a refresh.
 *
 * Every keystroke therefore goes to `localStorage` immediately, and the server
 * write happens the moment the draft becomes creatable. That ordering is what
 * makes "never lose work" true rather than aspirational: the local copy is the
 * safety net, the server is the destination.
 *
 * ── THE SAVE STATES ───────────────────────────────────────────────────────
 *
 * `local`   — kept on this device; not enough filled in to create the event.
 * `dirty`   — changes pending, save queued.
 * `saving`  — a request is in flight.
 * `saved`   — the server has it.
 * `offline` — the browser is offline; changes are held locally and flushed on
 *             reconnect. NOT an error, and not styled as one.
 * `error`   — the server refused. The message is shown; the local copy stands.
 *
 * ── CONCURRENCY ───────────────────────────────────────────────────────────
 *
 * One save runs at a time. If edits land during a save, `pending` is set and
 * another save fires when it finishes — so a fast typist gets one trailing
 * save rather than a queue of racing PATCHes, each of which would fail on the
 * optimistic-lock version anyway. Every successful write updates `version`
 * from the response, which is what the NEXT patch sends.
 *
 * ── HYDRATION WAITS FOR IDENTITY, AND THAT IS THE POINT ───────────────────
 *
 * The draft used to be seeded `useState(() => emptyDraft(organizationId))`.
 * A `useState` initialiser runs ONCE, on the first render — which is the
 * render where `GET /organizations/` has not answered yet, so the id was
 * always `''`. Nothing ever put it right for a fresh draft, `canCreate` stayed
 * false forever, and the wizard quietly never created the event.
 *
 * So nothing is seeded from props any more. The hook holds an empty draft
 * until `ready` says BOTH the account and its organisations are known, and
 * only then reads storage and resolves the organisation — one pass, with
 * every input present. `hydrated` stays false until it has, and the Studio
 * shows its skeleton, so there is no window in which a half-known draft is
 * editable.
 */

const AUTOSAVE_DELAY_MS = 1200;
const HISTORY_LIMIT = 50;

export type SaveState = 'local' | 'dirty' | 'saving' | 'saved' | 'offline' | 'error';

export type Wizard = ReturnType<typeof useWizard>;

export type WizardInput = {
  /** The signed-in account. `null` until `/auth/me` resolves. Namespaces the
   *  autosave key, so a shared browser cannot restore somebody else's draft. */
  userId: string | null;
  /** Ids from `GET /organizations/` — the ONLY ones `POST /events` accepts.
   *  Pass a stable (memoised) array; correctness does not depend on it, but a
   *  fresh array every render re-runs the effects below for nothing. */
  organizationIds: readonly string[];
  /** True once auth AND that list have resolved. Nothing is read from storage
   *  before it, because the key needs the account and the organisation needs
   *  the list. */
  ready: boolean;
};

export function useWizard({ userId, organizationIds, ready }: WizardInput) {
  const [draft, setDraftState] = React.useState<Draft>(() => emptyDraft());
  const [state, setState] = React.useState<SaveState>('local');
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const past = React.useRef<Draft[]>([]);
  const future = React.useRef<Draft[]>([]);
  const [historyTick, setHistoryTick] = React.useState(0);

  const saving = React.useRef(false);
  const pending = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef(draft);
  latest.current = draft;

  /** Last values the server confirmed, so a save is skipped when nothing moved. */
  const savedEvent = React.useRef('');
  const savedTiers = React.useRef<Record<string, string>>({});
  /**
   * A chosen cover image waiting to go up.
   *
   * Held here rather than in the draft because a `File` cannot be JSON
   * serialised into `localStorage` — so a refresh loses the pending file (and
   * the preview, which is a `blob:` URL pointing at it). That is the honest
   * boundary of "never lose work": the typed fields survive a refresh, an
   * un-uploaded image does not, and the Media step shows the file name plus
   * "uploads with the next save" so the state is visible rather than assumed.
   */
  const posterFile = React.useRef<File | null>(null);

  /* ── restore ──────────────────────────────────────────────────────── */

  const storageKey = userId ? draftStorageKey(userId) : null;
  /** Which key the draft in state came from, so the pass below runs once per
   *  account rather than on every render — and runs AGAIN if the account
   *  changes in this tab, which is what loads that person's own draft. */
  const restoredFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!ready || !storageKey) return;
    if (restoredFor.current === storageKey) return;
    restoredFor.current = storageKey;

    let stored: Partial<Draft> | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw) as Partial<Draft>;
    } catch {
      // Corrupt or blocked storage — start clean rather than crash the wizard.
    }

    const restored = restoreDraft(stored, organizationIds);
    past.current = [];
    future.current = [];
    savedTiers.current = {};
    posterFile.current = null;
    savedEvent.current = restored.eventId ? patchFingerprint(restored) : '';
    latest.current = restored;
    setDraftState(restored);
    setState(restored.eventId ? 'saved' : 'local');
    setHydrated(true);
    discardLegacyDraft();
  }, [ready, storageKey, organizationIds]);

  React.useEffect(() => {
    if (!hydrated || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Out of quota or private mode. The in-memory draft is still correct;
      // refusing to edit would be the worse failure.
    }
  }, [draft, hydrated, storageKey]);

  /* ── offline ──────────────────────────────────────────────────────── */

  React.useEffect(() => {
    const onOffline = () => setState('offline');
    const onOnline = () => {
      setState((current) => (current === 'offline' ? 'dirty' : current));
      void flush();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setState('offline');
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── mutate ───────────────────────────────────────────────────────── */

  const commit = React.useCallback((next: Draft, { history = true } = {}) => {
    if (history) {
      past.current = [...past.current.slice(-HISTORY_LIMIT), latest.current];
      future.current = [];
      setHistoryTick((tick) => tick + 1);
    }
    latest.current = next;
    setDraftState(next);
  }, []);

  /**
   * Adopt an organisation the moment one becomes resolvable.
   *
   * Normally the restore above has already done it — this covers the list
   * CHANGING afterwards: the organisations query refetching, or an account
   * that had none finishing its approval in another tab. It only ever touches
   * `organizationId`, never a field somebody has typed into, so it cannot
   * clobber a draft in progress; and it is `history: false`, because undoing
   * back to an organisation the API refuses is not an edit anyone made.
   *
   * A save is scheduled after it, because the draft may have been
   * complete-but-uncreatable the whole time waiting on exactly this.
   */
  React.useEffect(() => {
    if (!hydrated) return;
    const current = latest.current.organizationId;
    const resolved = resolveOrganizationId(current, organizationIds);
    if (resolved === current) return;
    commit({ ...latest.current, organizationId: resolved }, { history: false });
    if (resolved) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, organizationIds, commit]);

  const update = React.useCallback(
    (patch: Partial<Draft>) => {
      commit({ ...latest.current, ...patch });
      setState((current) => (current === 'offline' ? current : 'dirty'));
      schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );

  const setPoster = React.useCallback(
    (file: File | null) => {
      posterFile.current = file;
      setState((current) => (current === 'offline' ? current : 'dirty'));
      schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setTiers = React.useCallback(
    (next: DraftTier[]) => {
      commit({ ...latest.current, tiers: next });
      setState((current) => (current === 'offline' ? current : 'dirty'));
      schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit],
  );

  const undo = React.useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current = [latest.current, ...future.current];
    latest.current = previous;
    setDraftState(previous);
    setHistoryTick((tick) => tick + 1);
    setState('dirty');
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redo = React.useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    future.current = rest;
    past.current = [...past.current, latest.current];
    latest.current = next;
    setDraftState(next);
    setHistoryTick((tick) => tick + 1);
    setState('dirty');
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── save ─────────────────────────────────────────────────────────── */

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  async function flush(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline');
      return;
    }
    if (saving.current) {
      pending.current = true;
      return;
    }
    const current = latest.current;
    if (!canCreate(current)) {
      // Not enough to create the event yet. The local copy holds everything.
      setState('local');
      return;
    }

    saving.current = true;
    setState('saving');
    setError(null);
    try {
      let working = current;

      if (!working.eventId) {
        const created = await createEvent(toCreateInput(working));
        working = { ...working, eventId: created.id, version: created.version };
        savedEvent.current = patchFingerprint(working);
      } else if (patchFingerprint(working) !== savedEvent.current) {
        const updated = await updateEvent(working.eventId, toPatchInput(working));
        working = { ...working, version: updated.version };
        savedEvent.current = patchFingerprint(working);
      }

      // The poster, once the event exists to hang it on. After the field
      // PATCH, so a single save that changed both the title and the image
      // sends the title with the version it read and the image with the
      // version that PATCH returned.
      if (posterFile.current && working.eventId) {
        const uploaded = await uploadPoster(working.eventId, working.version, posterFile.current);
        posterFile.current = null;
        working = { ...working, version: uploaded.version, posterUrl: uploaded.poster_url };
      }

      // Tiers, in order. Sequential rather than parallel on purpose: each one
      // is a small write, and a burst of parallel creates against the same
      // event makes the failure modes much harder to reason about for no
      // meaningful latency win at these counts.
      const tiers: DraftTier[] = [];
      for (const tier of working.tiers) {
        const complete = tier.name.trim() && tier.price !== '' && Number(tier.quantity) >= 1;
        if (!complete) {
          tiers.push(tier);
          continue;
        }
        const fingerprint = tierFingerprint(tier);
        if (tier.serverId && savedTiers.current[tier.serverId] === fingerprint) {
          tiers.push(tier);
          continue;
        }
        if (!tier.serverId) {
          const created = await createTicketType(working.eventId as string, toTierInput(tier));
          savedTiers.current[created.id] = fingerprint;
          tiers.push({ ...tier, serverId: created.id, version: created.version });
        } else {
          const updated = await updateTicketType(tier.serverId, {
            version: tier.version ?? 1,
            ...toTierInput(tier),
          });
          savedTiers.current[tier.serverId] = fingerprint;
          tiers.push({ ...tier, version: updated.version });
        }
      }
      working = { ...working, tiers };

      // Merge rather than replace: the organizer may have typed during the
      // request, and overwriting `latest` with a stale snapshot is exactly how
      // an autosave eats a sentence.
      commit(
        {
          ...latest.current,
          eventId: working.eventId,
          version: working.version,
          // Once uploaded, the server's URL replaces the local `blob:` one —
          // which is what makes the preview survive a reload.
          posterUrl: working.posterUrl || latest.current.posterUrl,
          tiers: latest.current.tiers.map((tier) => {
            const persisted = working.tiers.find((candidate) => candidate.key === tier.key);
            return persisted
              ? { ...tier, serverId: persisted.serverId, version: persisted.version }
              : tier;
          }),
        },
        { history: false },
      );

      setSavedAt(Date.now());
      setState(pending.current ? 'dirty' : 'saved');
    } catch (thrown) {
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'Could not reach the server. Your changes are safe on this device.',
      );
      setState(thrown instanceof ApiError ? 'error' : 'offline');
    } finally {
      saving.current = false;
      if (pending.current) {
        pending.current = false;
        schedule();
      }
    }
  }

  const clearStored = React.useCallback(() => {
    if (!storageKey) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing to clean up if storage was never available.
    }
  }, [storageKey]);

  const saveNow = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    return flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publish = React.useCallback(async () => {
    await flush();
    const id = latest.current.eventId;
    if (!id) throw new ApiError(400, 'not_saved', 'The draft has not been saved yet.');
    const published = await publishEvent(id);
    commit({ ...latest.current, version: published.version }, { history: false });
    clearStored();
    return published;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, clearStored]);

  const reset = React.useCallback(() => {
    past.current = [];
    future.current = [];
    savedEvent.current = '';
    savedTiers.current = {};
    posterFile.current = null;
    // Keeps the organisation that was in play if it is still owned — a reset
    // is "start this event again", not "pick a company again".
    commit(emptyDraft(resolveOrganizationId(latest.current.organizationId, organizationIds)), {
      history: false,
    });
    setState('local');
    setSavedAt(null);
    clearStored();
  }, [commit, clearStored, organizationIds]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    draft,
    hydrated,
    state,
    error,
    savedAt,
    update,
    setPoster,
    setTiers,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    historyTick,
    saveNow,
    publish,
    reset,
  };
}
