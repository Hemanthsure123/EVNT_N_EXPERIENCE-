'use client';

import * as React from 'react';
import { ApiError } from '@/lib/api/errors';
import { addFaq, addSlot, addTimelineEntry, type TimelineKind } from '@/lib/api/event-content';
import { setEventCrew } from '@/lib/api/crew';
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
  asStrings,
  restoreDraft,
  tierFingerprint,
  tierIsSavable,
  toCreateInput,
  toPatchInput,
  toTierInput,
  toIso,
  cloneDraftFrom,
  draftFromEvent,
  type Draft,
  type DraftTier,
} from './model';
import type { EventDetail, TicketTier } from '@/lib/api/types';

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
/** Backoff before the ONE automatic retry of a network-ish save failure. */
const SAVE_RETRY_DELAY_MS = 4000;
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
  /**
   * EDIT MODE: the event being edited, already fetched, with its tiers.
   *
   * Fetched by the ROUTE rather than in here on purpose. Hydration below is
   * synchronous — it reads localStorage and commits in one pass — and making
   * it await a request would put a loading state, a failure state and a race
   * with the autosave timer into the one effect the create path depends on.
   * The route already has to handle "still loading" and "no such event" to
   * decide whether to render a wizard at all, so it does the fetching and
   * passes the answer in. `ready` stays the single gate.
   *
   * Absent or null means the create flow, which is unchanged.
   */
  existing?: { event: EventDetail; tiers: readonly TicketTier[] } | null;
  /**
   * CLONE MODE: an existing event to fill a NEW draft from.
   *
   * Mutually exclusive with `existing` — one says "edit this row", the other
   * says "start a new one that looks like this row". Passing both is a
   * programming error and `existing` wins, because editing the wrong event is
   * the more destructive of the two mistakes.
   */
  cloneSource?: {
    event: EventDetail;
    tiers: readonly TicketTier[];
    content: Parameters<typeof cloneDraftFrom>[2];
  } | null;
};

export function useWizard({ userId, organizationIds, ready, existing, cloneSource }: WizardInput) {
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
  /**
   * One armed retry for a network-ish failure — a single shot with backoff,
   * never a loop. The offline/online listeners own a real outage; this covers
   * the blip where `fetch` failed while `navigator.onLine` still said true,
   * which otherwise left the draft stranded until the next keystroke. Re-armed
   * by a save actually succeeding, so repeated failures cost one retry, not a
   * hammering interval.
   */
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryUsed = React.useRef(false);
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

  const storageKey = userId ? draftStorageKey(userId, existing?.event.id ?? null) : null;
  /** Mirrors `existing` for the hydration effect, which must not re-run when
   *  a refetch hands back an identical event. */
  const existingRef = React.useRef(existing);
  existingRef.current = existing;
  const cloneRef = React.useRef(cloneSource);
  cloneRef.current = cloneSource;
  /** Set once this draft is done with (published, submitted, or reset), so the
   *  persist effect stops re-creating what `clearStored` just removed. */
  const finished = React.useRef(false);
  /** Which key the draft in state came from, so the pass below runs once per
   *  account rather than on every render — and runs AGAIN if the account
   *  changes in this tab, which is what loads that person's own draft. */
  const restoredFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!ready || !storageKey) return;
    if (restoredFor.current === storageKey) return;
    restoredFor.current = storageKey;
    // A fresh mount of the wizard is a fresh draft's life, even when the user
    // never left the app — otherwise navigating away after a publish and back
    // to /new would land on a component whose guard is still tripped and which
    // therefore saves nothing at all.
    finished.current = false;

    let stored: Partial<Draft> | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw) as Partial<Draft>;
    } catch {
      // Corrupt or blocked storage — start clean rather than crash the wizard.
    }

    // ── EDIT MODE: THE SERVER IS THE SOURCE OF TRUTH ─────────────────────
    //
    // A stored draft is kept ONLY when its `version` still matches the one the
    // server just handed back. That is the crash-recovery case — the tab died
    // with unsaved edits and nothing else has touched the event since — and it
    // is the only case where local state is newer rather than merely older.
    //
    // Any other version means somebody saved in between (another tab, a
    // co-organizer, this person on their phone). Restoring over that would
    // show fields that no longer exist on the server and then PATCH them back,
    // silently reverting the newer edit. The server wins, and the local copy
    // is dropped rather than merged: a half-and-half draft is the one outcome
    // nobody could reason about afterwards.
    // ── CLONE MODE ─────────────────────────────────────────────────────
    //
    // A clone is a NEW draft filled from an event that already exists, so it
    // takes neither branch below: there is no server row to be the source of
    // truth, and a stored draft from some earlier unrelated session must not
    // be poured over it. Pressing Clone is an explicit instruction about what
    // this form should contain, and it wins.
    //
    // `savedEvent`/`savedTiers` are left EMPTY on purpose. They mean "what the
    // server has already confirmed", and for a clone that is nothing — seeding
    // them from the source would fingerprint the copy as already-saved and the
    // engine would skip the create that makes it exist.
    const cloneSource = cloneRef.current;
    if (cloneSource && !existingRef.current) {
      const seeded = cloneDraftFrom(
        cloneSource.event,
        cloneSource.tiers,
        cloneSource.content,
        organizationIds,
      );
      past.current = [];
      future.current = [];
      savedTiers.current = {};
      posterFile.current = null;
      savedEvent.current = '';
      latest.current = seeded;
      setDraftState(seeded);
      setState('local');
      setHydrated(true);
      return;
    }

    const source = existingRef.current;
    const server = source ? draftFromEvent(source.event, source.tiers, organizationIds) : null;
    const usableStored =
      server && stored ? (stored.version === server.version ? stored : null) : stored;

    // ── THE EDIT PATH DOES NOT GO THROUGH `restoreDraft` ─────────────────
    //
    // So it gets none of that function's normalisation, and this spread pours
    // unvalidated `localStorage` straight onto the server draft. `undefined`
    // is safe (it never survives `JSON.stringify`), but a stored `null` — from
    // a build that predates a field — round-trips intact and overwrites the
    // server's array. `draft.tags.length` on `null` is a white screen over a
    // real event. The version gate narrows the window; it does not close it,
    // because a stored draft at the same version is exactly the case this
    // branch exists to restore.
    const restored = server
      ? {
          ...server,
          ...(usableStored ?? {}),
          eventId: server.eventId,
          version: server.version,
          highlightsIncluded: asStrings(
            usableStored?.highlightsIncluded ?? server.highlightsIncluded,
          ),
          highlightsExcluded: asStrings(
            usableStored?.highlightsExcluded ?? server.highlightsExcluded,
          ),
          guidelines: asStrings(usableStored?.guidelines ?? server.guidelines),
          tags: asStrings(usableStored?.tags ?? server.tags),
        }
      : restoreDraft(stored, organizationIds);
    past.current = [];
    future.current = [];
    // ── SEEDED FROM THE SERVER, NEVER FROM THE RESTORED DRAFT ────────────
    //
    // These two refs are "what the server last confirmed". Seeding them from
    // `restored` would mark any recovered local edit as already-saved, and the
    // save engine would skip the very PATCH that edit exists to trigger.
    // Seeded from `server`, a recovered edit has a different fingerprint and
    // is written on the next flush — which is exactly what recovery means.
    savedTiers.current = {};
    if (server) {
      server.tiers.forEach((tier, position) => {
        if (tier.serverId) savedTiers.current[tier.serverId] = tierFingerprint(tier, position);
      });
    }
    posterFile.current = null;
    savedEvent.current = server
      ? patchFingerprint(server)
      : restored.eventId
        ? patchFingerprint(restored)
        : '';
    latest.current = restored;
    setDraftState(restored);
    setState(restored.eventId ? 'saved' : 'local');
    setHydrated(true);
    discardLegacyDraft();
    // A restored draft can be complete but never created: every required field
    // present, `eventId` still null, because the tab closed inside the
    // autosave delay or every earlier flush failed. Nothing else would ever
    // save it — edits schedule a flush, but re-opening and pressing Submit is
    // not an edit, and Submit itself is disabled BY the unsaved blocker. So
    // the save the draft was owed is scheduled here.
    // Only ever the CREATE path: an edit already exists on the server, so
    // there is no owed `POST` to schedule and a flush here would PATCH an
    // event nobody has touched yet.
    if (!server && !restored.eventId && canCreate(restored)) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, storageKey, organizationIds]);

  React.useEffect(() => {
    // ── A FINISHED DRAFT MUST NOT WRITE ITSELF BACK ────────────────────────
    //
    // `publish()` did `commit(...)` and then `clearStored()`. `commit` is a
    // setState, so React re-rendered AFTER the removeItem and this effect put
    // the whole draft straight back into localStorage. The clear was real and
    // instantly undone.
    //
    // The symptom was that opening Create Event again — after publishing, after
    // submitting, or after simply going Back — reopened the finished event's
    // values instead of a blank form, permanently, with no way to get a clean
    // one. `finished` is checked here because the guard has to outlive the
    // render that trips it, which a piece of state cannot.
    if (!hydrated || !storageKey || finished.current) return;
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

      // ── THE STAGED COLLECTIONS, BEFORE THE TIERS ─────────────────────
      //
      // Sessions, running-order entries and the lineup typed while there was
      // no event to hang them on. See `PendingSlot` in `model.ts` for why
      // they are staged rather than gated behind a "save the draft first"
      // message.
      //
      // BEFORE the tier loop, and that order is load-bearing: a tier can be
      // bound to a session, so the sessions have to have ids by the time the
      // tiers are written.
      //
      // Each row is attempted INDEPENDENTLY and a failure LEAVES IT STAGED
      // rather than dropping it: the draft is the only copy, and losing four
      // typed sessions because the fifth was refused is the outcome staging
      // exists to prevent. The rows that did land are cleared, so a retry
      // cannot create them twice.
      const flushedSlots: string[] = [];
      const flushedEntries: string[] = [];
      const flushedFaqs: string[] = [];
      let crewSynced = false;

      if (working.eventId) {
        for (const slot of working.pendingSlots) {
          try {
            await addSlot(working.eventId, {
              starts_at: toIso(slot.startsAt),
              label: slot.label.trim(),
              ends_at: slot.endsAt ? toIso(slot.endsAt) : null,
            });
            flushedSlots.push(slot.tempId);
          } catch {
            // Left staged; the save state carries the failure.
          }
        }

        for (const entry of working.pendingTimeline) {
          try {
            await addTimelineEntry(working.eventId, {
              kind: entry.kind as TimelineKind,
              label: entry.label.trim(),
              description: entry.description.trim(),
              starts_at: entry.startsAt ? toIso(entry.startsAt) : null,
              position: 0,
            });
            flushedEntries.push(entry.tempId);
          } catch {
            // Left staged.
          }
        }

        for (const faq of working.pendingFaqs) {
          try {
            await addFaq(working.eventId, {
              question: faq.question.trim(),
              answer: faq.answer.trim(),
              position: 0,
            });
            flushedFaqs.push(faq.tempId);
          } catch {
            // Left staged.
          }
        }

        // A SET REPLACEMENT, so it is safe to send whole and safe to retry —
        // which is why the lineup needs no per-row bookkeeping.
        if (working.crewIds.length) {
          try {
            await setEventCrew(working.eventId, working.crewIds);
            crewSynced = true;
          } catch {
            // Left staged.
          }
        }
      }

      // Tiers, in order. Sequential rather than parallel on purpose: each one
      // is a small write, and a burst of parallel creates against the same
      // event makes the failure modes much harder to reason about for no
      // meaningful latency win at these counts.
      const tiers: DraftTier[] = [];
      // `entries()`, because the INDEX is the merchandising position and the
      // server stores it — see `toTierInput`. Iterating the values alone is
      // what left every tier at position 0 while the ticket builder's reorder
      // controls appeared to work.
      for (const [position, tier] of working.tiers.entries()) {
        // Includes the sale-phase schedule: a half-typed phase is a payload the
        // serializer refuses, and sending it would make every autosave a 400 the
        // organizer cannot act on. See `tierIsSavable`.
        if (!tierIsSavable(tier)) {
          tiers.push(tier);
          continue;
        }
        const fingerprint = tierFingerprint(tier, position);
        if (tier.serverId && savedTiers.current[tier.serverId] === fingerprint) {
          tiers.push(tier);
          continue;
        }
        if (!tier.serverId) {
          const created = await createTicketType(
            working.eventId as string,
            toTierInput(tier, position),
          );
          savedTiers.current[created.id] = fingerprint;
          tiers.push({ ...tier, serverId: created.id, version: created.version });
        } else {
          const updated = await updateTicketType(tier.serverId, {
            version: tier.version ?? 1,
            ...toTierInput(tier, position),
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
          // FILTERED, never replaced — the same rule the tier merge above
          // follows. The organizer may have typed another session while the
          // request was in flight, and assigning the pre-flush array back
          // would eat it.
          pendingSlots: latest.current.pendingSlots.filter(
            (slot) => !flushedSlots.includes(slot.tempId),
          ),
          pendingTimeline: latest.current.pendingTimeline.filter(
            (entry) => !flushedEntries.includes(entry.tempId),
          ),
          pendingFaqs: latest.current.pendingFaqs.filter(
            (faq) => !flushedFaqs.includes(faq.tempId),
          ),
          // Cleared only when the PUT actually landed. From here the picker
          // reads the server, which is the source of truth for a lineup.
          crewIds: crewSynced ? [] : latest.current.crewIds,
        },
        { history: false },
      );

      setSavedAt(Date.now());
      setState(pending.current ? 'dirty' : 'saved');
      retryUsed.current = false;
    } catch (thrown) {
      // An ApiError is the server ANSWERING and refusing — retrying the same
      // request would get the same refusal, so it is shown and left alone.
      // Anything else is the request not arriving, which is worth one retry.
      const networkish = !(thrown instanceof ApiError);
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'Could not reach the server. Your changes are safe on this device.',
      );
      setState(networkish ? 'offline' : 'error');
      if (networkish && !retryUsed.current) {
        retryUsed.current = true;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => void flush(), SAVE_RETRY_DELAY_MS);
      }
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
    finished.current = true;
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
    // `reset` means "start a NEW event here", so persistence resumes — unlike
    // publish/submit, where the form is finished and the user is navigating
    // away. Set after `clearStored`, which trips the flag.
    finished.current = false;
  }, [commit, clearStored, organizationIds]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
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
