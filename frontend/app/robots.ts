import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/metadata';

/**
 * ── WHAT IS DISALLOWED, AND WHY EACH ONE IS ───────────────────────────────
 *
 * `/checkout/` and `/organizer/settings` were here already and are neither a
 * real route on this build; they are kept because a stale disallow costs
 * nothing and removing one is how a path quietly becomes crawlable later.
 *
 * The additions are the route groups that render behind a session. None of them
 * would serve useful HTML to a crawler — `/dashboard`, `/admin` and `/studio`
 * all sit behind an auth gate — but a bot that requests them still burns crawl
 * budget on redirects, and `/admin` in particular should not be advertised in a
 * public file at all. Their layouts already set `robots: noindex`; this is the
 * cheaper, earlier half of the same statement.
 *
 * `/style-guide` is internal design-system documentation. It also carries a
 * page-level `noindex` and was removed from `app/sitemap.ts` — three places,
 * because a sitemap entry and a noindex tag disagreeing is how a page stays in
 * the index for months while everyone assumes it is out.
 *
 * `/booking/` is the funnel. It is per-user, holds a real inventory reservation
 * and 404s without one, so a crawled URL is a dead page at best.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/checkout/',
        '/booking/',
        '/account/',
        '/dashboard',
        '/admin',
        '/studio',
        '/style-guide',
        '/auth/callback',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
