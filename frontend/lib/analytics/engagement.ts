import { API_ROOT } from '@/lib/api/client';
import { CITY_STORAGE_KEY } from '@/lib/location/use-location';

/**
 * The browser half of the organizer's views, impressions and click-through.
 *
 * ── WHY THE BROWSER COUNTS ────────────────────────────────────────────────
 *
 * The public event page is edge-cached, with a warm server path of zero
 * queries. A request the CDN answers never reaches Django, so a server-side
 * counter would count cache misses rather than people. The page reports what it
 * showed instead, and nothing on the read path moves.
 *
 * ── WHAT COUNTS AS WHAT ───────────────────────────────────────────────────
 *
 * - An IMPRESSION is a card at least half on screen in a list, once per card
 *   per page load (`EngagementTracker` watches every `[data-event-poster]`).
 * - A VIEW is the event page or the mobile event widget opened on an event,
 *   once per event per tab per half hour — a reload is not a second person.
 * - A view is a FEED view when it followed a press on one of that event's
 *   cards within a minute: the numerator of click-through. Everything else —
 *   a shared link, a bookmark, an email — is direct.
 *
 * ── WHAT IS SENT ──────────────────────────────────────────────────────────
 *
 * Event ids, a source, and the city the visitor chose in the header (the same
 * `localStorage` value the city switcher writes). No account, no token, no
 * device id. The server compares the city with the event's and keeps only the
 * counts.
 *
 * ── ONLY WHERE THE PUBLIC SITE IS MOUNTED ─────────────────────────────────
 *
 * Nothing is recorded until `armEngagement()` runs, and only the public site's
 * layout calls it. The organizer dashboard renders event components too — a
 * preview, the home page inside the portal — and an organizer checking their
 * own draft is not an audience.
 *
 * Every storage access is guarded: private windows and blocked site data throw
 * on `sessionStorage`, and a counter must never break a page to count it.
 */

export const ENGAGEMENT_ENDPOINT = `${API_ROOT}/events/engagement`;

/** A reload inside this window is the same person looking again. */
export const VIEW_TTL_MS = 30 * 60 * 1000;
/** A view this soon after pressing that event's card was a click-through. */
export const PRESS_WINDOW_MS = 60 * 1000;
/** How often queued counts are sent while the page is open. */
export const FLUSH_INTERVAL_MS = 10_000;
/** The server's bounds — mirrored, so a busy page splits across beacons. */
export const MAX_IMPRESSIONS = 100;
export const MAX_VIEWS = 20;

const PRESS_KEY = 'ee-press';
const VIEW_KEY_PREFIX = 'ee-view:';

export type ViewSource = 'feed' | 'direct';
export type Beacon = {
  impressions: string[];
  views: { event_id: string; source: ViewSource }[];
  city: string | null;
};

type Press = { id: string; at: number };

const state = {
  armed: 0,
  queuedImpressions: new Set<string>(),
  impressedThisPage: new Set<string>(),
  queuedViews: new Map<string, ViewSource>(),
};

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function readCity(): string | null {
  try {
    const value = window.localStorage.getItem(CITY_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * Start counting. Returns the matching disarm. A COUNT rather than a flag, so a
 * tracker remounting during a navigation cannot disarm the one that replaced it.
 */
export function armEngagement(): () => void {
  state.armed += 1;
  return () => {
    state.armed = Math.max(0, state.armed - 1);
  };
}

export function isArmed(): boolean {
  return state.armed > 0;
}

/** A card was at least half on screen. Once per card per page load. */
export function recordImpression(eventId: string): void {
  if (!isArmed() || !eventId || state.impressedThisPage.has(eventId)) return;
  state.impressedThisPage.add(eventId);
  state.queuedImpressions.add(eventId);
}

/** Somebody pressed a card for this event — the view that follows is a feed view. */
export function rememberPress(eventId: string, now: number = Date.now()): void {
  if (!eventId) return;
  try {
    session()?.setItem(PRESS_KEY, JSON.stringify({ id: eventId, at: now } satisfies Press));
  } catch {
    /* storage refused — the view will simply count as direct */
  }
}

/** Pure: was this view a click-through from a card pressed a moment ago? */
export function viewSource(press: Press | null, eventId: string, now: number): ViewSource {
  return press && press.id === eventId && now - press.at <= PRESS_WINDOW_MS ? 'feed' : 'direct';
}

function readPress(): Press | null {
  try {
    const raw = session()?.getItem(PRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Press>;
    return typeof parsed.id === 'string' && typeof parsed.at === 'number'
      ? { id: parsed.id, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

/**
 * The event page (or the mobile widget) opened on this event.
 *
 * Once per event per tab per `VIEW_TTL_MS`. The mobile arrival renders both the
 * page and the widget over it, and this is what stops that being two views.
 */
export function recordView(eventId: string, now: number = Date.now()): void {
  if (!isArmed() || !eventId) return;
  const store = session();
  const key = `${VIEW_KEY_PREFIX}${eventId}`;
  try {
    const last = Number(store?.getItem(key) ?? 0);
    if (last && now - last < VIEW_TTL_MS) return;
    store?.setItem(key, String(now));
  } catch {
    /* no storage: count it once for this page load, which the queue does */
  }
  const source = viewSource(readPress(), eventId, now);
  // A feed press wins over an earlier direct arrival queued for the same event.
  if (state.queuedViews.get(eventId) !== 'feed') state.queuedViews.set(eventId, source);
  if (source === 'feed') {
    try {
      session()?.removeItem(PRESS_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Take up to one beacon's worth of what is queued, and remove it from the
 * queue. `null` when there is nothing to send.
 */
export function takeBeacon(): Beacon | null {
  const impressions = [...state.queuedImpressions].slice(0, MAX_IMPRESSIONS);
  const views = [...state.queuedViews.entries()]
    .slice(0, MAX_VIEWS)
    .map(([event_id, source]) => ({ event_id, source }));
  if (!impressions.length && !views.length) return null;
  impressions.forEach((id) => state.queuedImpressions.delete(id));
  views.forEach((view) => state.queuedViews.delete(view.event_id));
  return { impressions, views, city: readCity() };
}

/**
 * Send what is queued. `keepalive` lets the request outlive the page, which is
 * what a flush on `pagehide` needs. Failures are dropped on purpose: these are
 * indicative counts, and retrying one would double-count it the moment the
 * first attempt had in fact arrived.
 */
export function flushEngagement({ keepalive = false }: { keepalive?: boolean } = {}): void {
  for (let guard = 0; guard < 5; guard += 1) {
    const beacon = takeBeacon();
    if (!beacon) return;
    try {
      void fetch(ENGAGEMENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(beacon),
        keepalive,
        credentials: 'omit',
      }).catch(() => undefined);
    } catch {
      return;
    }
  }
}

/** Tests only: forget everything this module has seen. */
export function resetEngagementForTests(): void {
  state.armed = 0;
  state.queuedImpressions.clear();
  state.impressedThisPage.clear();
  state.queuedViews.clear();
}
