import type { MetadataRoute } from 'next';
import { fetchEventSitemapSafe } from '@/lib/api/events';
import { fetchPerformerSitemapSafe } from '@/lib/api/performers';
import { CATEGORIES } from '@/lib/discovery/categories';
import { eventPath } from '@/lib/events/ref';
import { SITE_URL } from '@/lib/seo/metadata';

/**
 * The site's sitemap: the home page, the browse hub, every city and category
 * LANDING page, the static company/legal/support pages, EVERY LIVE EVENT, and
 * every published performer profile.
 *
 * ── THE EVENT URLS ARE THE POINT ──────────────────────────────────────────
 *
 * They used to be absent, on the reasoning that enumerating them meant crawling
 * a cursor-paginated list. That reasoning held, and the consequence was that
 * the pages carrying `Event` structured data — the ones eligible for a rich
 * result, and the only pages on the platform somebody actually searches for —
 * were reachable to a crawler only by walking landing pages that show twenty
 * events each with no paginated URLs. Everything past the twentieth soonest
 * event in a city was, in practice, undiscoverable.
 *
 * `GET /events/sitemap` (BACKLOG item 7) is the seam that fixes it: three
 * columns, unpaginated, edge-cached for an hour. Performer profiles are here
 * for a related reason — they are indexable and canonical'd, and had no inbound
 * link from anywhere on the public site.
 *
 * ── `lastModified` IS REAL NOW ────────────────────────────────────────────
 *
 * Every entry used to be stamped with `new Date()` — the build time — which
 * tells a crawler that the entire site changed at once and therefore nothing in
 * particular is worth re-fetching. Events and performers carry their own
 * `updated_at`. The static routes still use the build time, correctly: their
 * content genuinely does change only when the site is rebuilt.
 *
 * ── A FAILED FETCH DEGRADES, IT DOES NOT 500 ──────────────────────────────
 *
 * Both reads are the `...Safe` variants. An exception here would not drop the
 * event URLs, it would take `/sitemap.xml` down completely, and the static half
 * is worth far more than a 500.
 *
 * `/style-guide` USED TO BE HERE, at priority 0.1. It is internal design-system
 * documentation, and listing it submitted a swatch grid to Google as though it
 * were product. It is now `robots: noindex` on the page itself and disallowed in
 * robots.txt as well — three places, because a sitemap entry and a noindex tag
 * disagreeing is how a page stays in the index for months.
 *
 * ── PRIORITY IS RELATIVE, AND ONLY WITHIN THIS FILE ───────────────────────
 *
 * Google treats `priority` as a hint about relative importance across a single
 * site, not as a ranking input. The ladder here says what the product is: the
 * home and browse pages first, then the landing pages that carry real inventory,
 * then the pages that convert supply (`/organizer`, `/pricing`), then support,
 * then legal — which people reach from the footer when they need them, never
 * from a search.
 */

/** Static routes that are not landing pages. Kept as one list so adding a page is one line. */
const STATIC_ROUTES: ReadonlyArray<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
}> = [
  // Supply side — these are the pages that turn a reader into an organizer, and
  // they are the only marketing pages on the site.
  { path: '/organizer', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/hire', priority: 0.8, changeFrequency: 'daily' },

  // Support. `/help` genuinely answers search queries ("how do I get a refund"),
  // which is why it outranks the rest of this block.
  { path: '/help', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'monthly' },

  // Company.
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/careers', priority: 0.3, changeFrequency: 'weekly' },

  // Legal. Low priority but genuinely indexable: a payment provider, a partner
  // and an app store all check that these exist and are reachable without a
  // login, and an unindexed policy page is one somebody has to be sent a link to.
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/refunds', priority: 0.4, changeFrequency: 'yearly' },
  { path: '/cookies', priority: 0.2, changeFrequency: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // In parallel: neither depends on the other, and this route is regenerated
  // on a long interval rather than per request, so the cost is paid once.
  const [events, performers] = await Promise.all([
    fetchEventSitemapSafe(),
    fetchPerformerSitemapSafe(),
  ]);

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'hourly' as const, priority: 1 },
    {
      url: `${SITE_URL}/events`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.9,
    },
    ...CATEGORIES.map((category) => ({
      url: `${SITE_URL}/categories/${category.slug}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...STATIC_ROUTES.map((route) => ({
      url: `${SITE_URL}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),

    // Every live event. Priority 0.8 — the same as a landing page, because
    // these ARE the destination: a landing page exists to lead here.
    // `daily`, because price and availability move on an event that is selling.
    ...events.map((event) => ({
      url: `${SITE_URL}${eventPath(event)}`,
      lastModified: new Date(event.updated_at),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),

    // Published performer profiles. `weekly` rather than `daily`: a profile is
    // a description of an act, not a live inventory count, so claiming daily
    // change would spend crawl budget re-fetching pages that did not move.
    ...performers.map((performer) => ({
      url: `${SITE_URL}/hire/${performer.id}`,
      lastModified: new Date(performer.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
