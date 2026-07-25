import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/metadata';

/** Static routes for now; dynamic event/city routes are added as those pages
 * are built (generated from the API). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ['', '/events', '/style-guide'];
  return routes.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === '' ? 'daily' : 'weekly',
    priority: route === '' ? 1 : 0.7,
  }));
}
