import type { MetadataRoute } from 'next';
import { CATEGORIES } from '@/lib/discovery/categories';
import { POPULAR_CITIES } from '@/lib/discovery/cities';
import { SITE_URL } from '@/lib/seo/metadata';

/**
 * The discovery surface's sitemap: the home page, the browse hub, and every
 * city and category LANDING page (the ones that are statically prerendered and
 * meant to rank).
 *
 * Individual event URLs are deliberately absent for now — enumerating them
 * needs a full crawl of the cursor-paginated list on every sitemap request. The
 * landing pages link to every live event, so they're all discoverable; a
 * dedicated `GET /events/sitemap` (ids + updated_at, no pagination) is the
 * right backend seam for listing them directly. See BACKLOG.md item 7.
 */
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
    {
      url: `${SITE_URL}/style-guide`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.1,
    },
  ];
}
