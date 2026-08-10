import type { MetadataRoute } from 'next';
import { CATEGORIES } from '@/lib/discovery/categories';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { SITE_URL } from '@/lib/seo/metadata';

/**
 * The discovery surface's sitemap: the home page, the browse hub, every city
 * and category LANDING page (the ones that are statically prerendered and meant
 * to rank), and the static company/legal/support pages.
 *
 * Individual event URLs are deliberately absent for now — enumerating them
 * needs a full crawl of the cursor-paginated list on every sitemap request. The
 * landing pages link to every live event, so they're all discoverable; a
 * dedicated `GET /events/sitemap` (ids + updated_at, no pagination) is the
 * right backend seam for listing them directly. See BACKLOG.md item 7.
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

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'hourly' as const, priority: 1 },
    {
      url: `${SITE_URL}/events`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/cities`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
    ...CATEGORIES.map((category) => ({
      url: `${SITE_URL}/categories/${category.slug}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...POPULAR_CITIES.map((city) => ({
      url: `${SITE_URL}/cities/${city.slug}`,
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
  ];
}
