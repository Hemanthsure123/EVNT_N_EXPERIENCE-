'use client';

/**
 * The data the mobile event widget renders.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The widget opens from a card in the feed, so all it was ever handed is an
 * `EventCard` — the LIST payload. That carries the title, poster, venue, city,
 * start time, price and organiser name, and nothing else.
 *
 * Everything the widget is supposed to show below the fold — the description,
 * the language and age rules, the running order, the gallery, the FAQs, the
 * organiser's policies, the real ticket tiers — lives on `GET /events/{id}`,
 * `GET /events/{id}/content` and `GET /events/{id}/ticket-types`, none of which
 * it ever called. So every one of those sections was a LITERAL in the source:
 * "Event will be in English", "Ticket needed for ages 21 and above", a
 * description about "Quake Arena", a schedule row reading "Starts at 8 PM".
 * Identical on every event, and wrong on almost all of them.
 *
 * Fetching is the fix, not better placeholders.
 *
 * ── THE CARD PAINTS FIRST ─────────────────────────────────────────────────
 *
 * The widget opens on a tap and must be on screen immediately, so it renders
 * from the `EventCard` it already has and fills in the rest as it arrives.
 * Nothing below the fold is required for the first frame; a section with no
 * data yet is ABSENT, exactly as it is for an event that genuinely has none.
 * That is the same rule the page follows, so there is no "loading" state that
 * looks different from "this organiser did not fill that in".
 *
 * ── THREE QUERIES, NOT ONE ────────────────────────────────────────────────
 *
 * They have genuinely different freshness requirements and the backend already
 * treats them differently:
 *
 *   detail   — edge-cached, 60s. Cheap, and the widget's spine.
 *   content  — edge-cached, 60s, and NEVER throws (it is enrichment: a failed
 *              FAQ read must not cost you the poster and the buy button).
 *   tiers    — `no-store`, ALWAYS. Inventory is the one thing that must never
 *              be served from a cache: a stale "2 left" is how you sell a
 *              ticket that does not exist. `staleTime: 0` here is the client
 *              half of that same decision.
 *
 * React Query is already mounted at the root (`app/providers.tsx`), so swiping
 * back to an event you looked at a moment ago is instant from its cache rather
 * than a second round trip.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchEventContentSafe, fetchEventDetail, fetchEventTiers } from '@/lib/api/events';
import type { EventContent } from '@/lib/api/event-content';
import type { EventDetail, TicketTier } from '@/lib/api/types';

/** Matches the backend's own edge-cache clock for the public detail read. */
const DETAIL_STALE_MS = 60_000;

export type EventWidgetData = {
  detail: EventDetail | null;
  content: EventContent | null;
  tiers: TicketTier[] | null;
  /** True only while the SPINE is still in flight. Content and tiers filling in
   *  later is not "loading" — those sections are simply absent until they land,
   *  which is what they look like for an event that has none. */
  isLoadingDetail: boolean;
};

/**
 * @param eventId The event to load, or `null` to load nothing (the widget is
 *   closed). Passing null rather than conditionally calling the hook keeps the
 *   hook order stable across open/close, which is a rules-of-hooks requirement.
 */
export function useEventWidgetData(eventId: string | null): EventWidgetData {
  const enabled = Boolean(eventId);

  const detail = useQuery({
    queryKey: ['event-widget', 'detail', eventId],
    queryFn: () => fetchEventDetail(eventId as string),
    enabled,
    staleTime: DETAIL_STALE_MS,
    // A blip below the poster must never take the widget down; the card data
    // it opened with is enough to book from.
    retry: 1,
  });

  const content = useQuery({
    queryKey: ['event-widget', 'content', eventId],
    queryFn: () => fetchEventContentSafe(eventId as string),
    enabled,
    staleTime: DETAIL_STALE_MS,
    retry: 1,
  });

  const tiers = useQuery({
    queryKey: ['event-widget', 'tiers', eventId],
    queryFn: () => fetchEventTiers(eventId as string).then((r) => r.data),
    enabled,
    // NEVER cached as fresh. See the header: availability is display-only and
    // must not be stale, because the reserve decision the backend makes under a
    // row lock can disagree with it at any moment.
    staleTime: 0,
    gcTime: 30_000,
    retry: 1,
  });

  return {
    detail: detail.data ?? null,
    content: content.data ?? null,
    tiers: tiers.data ?? null,
    isLoadingDetail: enabled && detail.isPending,
  };
}
