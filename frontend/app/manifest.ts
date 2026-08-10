import type { MetadataRoute } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { MANIFEST_BACKGROUND_COLOR, MANIFEST_THEME_COLOR } from '@/lib/seo/og-tokens';

/**
 * ── THE APP SHIPPED A SERVICE WORKER AND NO MANIFEST ──────────────────────
 *
 * `app/sw.js/route.ts` has been serving a real service worker for Web Push
 * since that slice landed. A service worker without a manifest gets you the
 * push subscription and NONE of the rest: no install prompt, no home-screen
 * icon, no standalone window, no splash. On Android — which is where the
 * overwhelming majority of Indian ticketing traffic is — the browser will not
 * offer "Add to Home screen" at all without this file, so the product had the
 * expensive half of installability and none of the payoff.
 *
 * ── WHY `display: 'standalone'` AND NOT `fullscreen` ──────────────────────
 *
 * A ticket is a thing you show to somebody at a gate, often in a hurry, often
 * on a phone you are holding out at arm's length. `standalone` keeps the OS
 * status bar — clock and battery — which is genuinely useful at a venue and
 * costs a strip of screen nobody was reading. `fullscreen` would also swallow
 * the back gesture affordance on some Android skins.
 *
 * ── THE SHORTCUTS ARE THE TWO THINGS PEOPLE RE-OPEN THE APP FOR ───────────
 *
 * Long-pressing the icon offers them. "My tickets" is the one that matters:
 * the second reason anyone installs a ticketing app is to get to the QR
 * without hunting for an email. "Browse events" is the first reason.
 *
 * Both point at routes that EXIST. A shortcut to a 404 is worse than no
 * shortcut, and it is the sort of thing nobody tests because it lives behind a
 * long-press.
 *
 * ── ICONS ARE GENERATED, NOT SHIPPED ──────────────────────────────────────
 *
 * `app/icon.tsx` and `app/apple-icon.tsx` rasterise the real `BrandMark`
 * vector at build time, so there is no PNG in `public/` to fall out of sync
 * with the mark the header draws. `purpose: 'maskable'` matters on Android:
 * without a maskable icon the launcher drops the mark into a white circle with
 * its own padding, which crops a mark drawn to the edges. Ours carries its own
 * safe-area padding — see the note in `icon.tsx`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND_NAME} — Discover & book live events`,
    short_name: BRAND_NAME,
    description:
      'Discover events and experiences, book tickets in seconds, and get in with a single scan.',
    start_url: '/',
    // Scoped to the whole origin: the funnel, the tickets page and the
    // organizer dashboard should all stay inside the installed window rather
    // than kicking out to a browser tab mid-checkout.
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: MANIFEST_BACKGROUND_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
    categories: ['entertainment', 'events', 'lifestyle'],
    lang: 'en-IN',
    dir: 'ltr',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
    shortcuts: [
      {
        name: 'My tickets',
        short_name: 'Tickets',
        description: 'The QR codes for events you have booked',
        url: '/account/tickets',
      },
      {
        name: 'Browse events',
        short_name: 'Browse',
        description: 'Everything on sale near you',
        url: '/events',
      },
    ],
  };
}
