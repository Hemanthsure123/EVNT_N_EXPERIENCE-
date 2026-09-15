'use client';

import * as React from 'react';
import {
  FLUSH_INTERVAL_MS,
  armEngagement,
  flushEngagement,
  recordImpression,
  rememberPress,
} from '@/lib/analytics/engagement';

/**
 * Counts what the public site SHOWED — the organizer's impressions and
 * click-through. Mounted once, by `app/(site)/layout.tsx`.
 *
 * ── ONE OBSERVER, NOT A HOOK IN EVERY CARD ────────────────────────────────
 *
 * Every event card on the site already carries `data-event-poster={id}` — the
 * shared-poster flight reads it to find where a tap came from. So impressions
 * are ONE `IntersectionObserver` over that attribute, and a `MutationObserver`
 * picks up the cards that rails and infinite lists add later. No card component
 * had to change, and a card added next year is counted the day it ships, because
 * it will carry the attribute for the flight anyway.
 *
 * ── THE PRESS IS CAPTURED, NOT CLICKED ────────────────────────────────────
 *
 * `pointerdown` in the capture phase, like the deck's own press tracking: a
 * card's `click` may be swallowed or turned into a navigation before a bubbling
 * listener sees it. The press is remembered for a minute, and the view that
 * follows is a feed view — see `lib/analytics/engagement.ts`.
 *
 * ── ARMED IN A LAYOUT EFFECT ──────────────────────────────────────────────
 *
 * `useLayoutEffect` runs before every passive effect in the same commit, so by
 * the time a page's `TrackEventView` records a view, counting is already on —
 * without depending on where in the tree this component happens to sit.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function EngagementTracker() {
  useIsomorphicLayoutEffect(() => armEngagement(), []);

  React.useEffect(() => {
    const cleanups: (() => void)[] = [];

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
            const id = (entry.target as HTMLElement).dataset.eventPoster;
            if (id) recordImpression(id);
            // Once per card per page load: nothing more to learn from it.
            observer.unobserve(entry.target);
          }
        },
        { threshold: [0.5] },
      );
      const watch = (root: ParentNode) => {
        root
          .querySelectorAll<HTMLElement>('[data-event-poster]')
          .forEach((node) => observer.observe(node));
      };
      watch(document);

      const mutations = new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.matches('[data-event-poster]')) observer.observe(node);
            watch(node);
          });
        }
      });
      mutations.observe(document.body, { childList: true, subtree: true });
      cleanups.push(() => {
        observer.disconnect();
        mutations.disconnect();
      });
    }

    const onPress = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      // The press lands on the card — its title, its price — rather than on
      // the poster inside it, so look up to the pressable and back down.
      const poster =
        target.closest<HTMLElement>('[data-event-poster]') ??
        target.closest('a, button, [role="button"]')?.querySelector<HTMLElement>(
          '[data-event-poster]',
        );
      const id = poster?.dataset.eventPoster;
      if (id) rememberPress(id);
    };
    document.addEventListener('pointerdown', onPress, { capture: true });

    const timer = window.setInterval(() => flushEngagement(), FLUSH_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushEngagement({ keepalive: true });
    };
    const onPageHide = () => flushEngagement({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      document.removeEventListener('pointerdown', onPress, { capture: true });
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      // Leaving the public site (into the dashboard, say) sends what it saw.
      flushEngagement({ keepalive: true });
    };
  }, []);

  return null;
}
