import { api } from './client';

/**
 * Admin-authored homepage content and platform announcements.
 *
 * ── WHY THESE ARE FETCHED ON THE SERVER ───────────────────────────────────
 *
 * `GET /homepage` and `GET /announcements` are PUBLIC, identical for everyone
 * in a city scope, and carry `s-maxage` + `stale-while-revalidate`. That makes
 * them exactly the wrong thing to fetch from the browser: doing so would put a
 * round trip in front of the hero — the LCP element on the busiest page on the
 * platform — for content that is the same for every visitor.
 *
 * So they are read during the server render with an ISR window matched to the
 * backend's own `s-maxage`. The copy is in the HTML; there is no spinner, no
 * layout shift, and a CDN absorbs the load.
 *
 * ── WHY THERE ARE NO FALLBACK CONSTANTS HERE ──────────────────────────────
 *
 * The defaults live in a DATA MIGRATION (`cms/0002_seed_defaults`), not in
 * this file. A hardcoded fallback headline would be exactly the thing the CMS
 * exists to remove: copy an operator cannot edit, silently winning whenever
 * the network hiccups. If the request fails the page renders without the
 * optional chrome rather than with stale invented copy — see `getHomepageSafe`.
 */

/** Matches the backend's `s-maxage` on `/homepage`. */
export const HOMEPAGE_REVALIDATE_SECONDS = 60;

export type HomepageCard = {
  entry_id: string;
  id: string;
  /**
   * The readable half of `/events/{slug}-{id}`, so a curated front-page link is
   * the CANONICAL URL rather than a bare-uuid one that immediately 308s — a
   * redirect on the most-clicked links on the site.
   *
   * Optional for the same reason it is on `EventCard`: this frontend must
   * typecheck and deploy against a backend that has not shipped the column,
   * and `eventPath()` falls back to the bare-id URL.
   */
  slug?: string;
  title: string;
  venue: string;
  city: string;
  starts_at: string;
  poster_url: string;
  from_price: number | null;
  tickets_available: number | null;
  organization_id: string;
  organization_name: string;
};

export type CollectionKey = 'featured' | 'trending' | 'editors_pick' | 'recommended' | 'new';

export type HomepageCategory = {
  id: string;
  slug: string;
  label: string;
  /** A lucide icon NAME, resolved against a bundled allow-list on the client. */
  icon: string;
  search_term: string;
};

/** A city the operator promotes on the front page. */
export type HomepageFeaturedCity = {
  id: string;
  name: string;
  image_url: string;
};

/**
 * A suggested search for the panel's empty state.
 *
 * `label` is what the chip says; `query` is what pressing it searches. They
 * differ on purpose — a chip can read "Comedy nights" while querying the stem
 * that actually matches rows.
 */
export type HomepagePopularSearch = {
  id: string;
  label: string;
  query: string;
};

export type Homepage = {
  hero: {
    headline: string;
    description: string;
    primary_cta: string;
    secondary_cta: string;
    search_placeholder: string;
    trust_badges: string[];
  };
  ribbon: { enabled: boolean; text: string };
  footer_note: string;
  categories: HomepageCategory[];
  /** Curation, NOT the platform's city list — every city with an event is
      already searchable and already has a landing page. */
  featured_cities: HomepageFeaturedCity[];
  popular_searches: HomepagePopularSearch[];
  collections: Record<CollectionKey, HomepageCard[]>;
  version: number;
  generated_at: string;
};

export function fetchHomepage(city?: string): Promise<Homepage> {
  const query = city ? `?city=${encodeURIComponent(city)}` : '';
  return api.get<Homepage>(`/homepage${query}`, {
    auth: false,
    next: { revalidate: HOMEPAGE_REVALIDATE_SECONDS },
  });
}

/**
 * The homepage must render even if the CMS request fails.
 *
 * Returns `null` rather than invented content, so callers fall back to
 * rendering without the admin-managed chrome — a front page missing its
 * ribbon is a much smaller failure than one showing copy nobody wrote.
 */
export async function fetchHomepageSafe(city?: string): Promise<Homepage | null> {
  try {
    return await fetchHomepage(city);
  } catch {
    return null;
  }
}

export type AnnouncementKind = 'maintenance' | 'feature' | 'promotion' | 'emergency';

export type LiveAnnouncement = {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  /** Always a same-origin path — the backend refuses anything else. */
  link_path: string;
  link_label: string;
  dismissible: boolean;
};

export type Placement = 'home' | 'organizer' | 'admin';

export async function fetchAnnouncementsSafe(
  placement: Placement = 'home',
): Promise<LiveAnnouncement[]> {
  try {
    const body = await api.get<{ data: LiveAnnouncement[] }>(
      `/announcements?placement=${placement}`,
      placement === 'home'
        ? { auth: false, next: { revalidate: HOMEPAGE_REVALIDATE_SECONDS } }
        : undefined,
    );
    return body.data;
  } catch {
    // A banner that fails to load is not worth failing a page over.
    return [];
  }
}

/* ───────────────────────────── admin writes ───────────────────────────── */

/**
 * The EDITOR's read — deliberately not `fetchHomepage`.
 *
 * `GET /homepage` is cached for ten minutes and served from the edge, which
 * means its `version` is a cached number. Seeding the optimistic lock from
 * there sends a stale version and 409s on every save, so the operator sees
 * "someone else edited this" forever and nothing they type can be saved.
 * This read is uncached and staff-only.
 */
export type HomepageDraft = {
  version: number;
  hero_headline: string;
  hero_description: string;
  hero_primary_cta: string;
  hero_secondary_cta: string;
  search_placeholder: string;
  ribbon_text: string;
  ribbon_enabled: boolean;
  trust_badges: string[];
  footer_note: string;
};

export const fetchHomepageDraft = () => api.get<HomepageDraft>('/admin/homepage');

export type UpdateHomepageInput = {
  version: number;
  hero_headline?: string;
  hero_description?: string;
  hero_primary_cta?: string;
  hero_secondary_cta?: string;
  search_placeholder?: string;
  ribbon_text?: string;
  ribbon_enabled?: boolean;
  trust_badges?: string[];
  footer_note?: string;
};

export const updateHomepage = (input: UpdateHomepageInput) =>
  api.patch<{ version: number }>('/admin/homepage', input);

export type AdminFeatured = {
  id: string;
  collection: CollectionKey;
  position: number;
  city: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  event_id: string;
  event_title: string;
  event_status: string;
  event_starts_at: string;
};

export const fetchAdminFeatured = () =>
  api.get<{ data: AdminFeatured[] }>('/admin/homepage/featured');

export const featureEvent = (input: {
  event_id: string;
  collection: CollectionKey;
  position?: number;
  city?: string;
  starts_at?: string | null;
  ends_at?: string | null;
}) => api.post<{ id: string }>('/admin/homepage/featured', input);

export const unfeature = (entryId: string) =>
  api.delete<void>(`/admin/homepage/featured/${encodeURIComponent(entryId)}`);

export const reorderFeatured = (order: { id: string; position: number }[]) =>
  api.post<{ ok: boolean }>('/admin/homepage/featured/reorder', { order });

export type AdminCategory = HomepageCategory & {
  position: number;
  is_visible: boolean;
  archived_at: string | null;
};

export const fetchAdminCategories = () => api.get<{ data: AdminCategory[] }>('/admin/categories');

export const createCategory = (input: {
  slug: string;
  label: string;
  icon?: string;
  search_term?: string;
  position?: number;
  is_visible?: boolean;
}) => api.post<AdminCategory>('/admin/categories', input);

export const updateCategory = (
  categoryId: string,
  input: Partial<Omit<AdminCategory, 'id' | 'slug' | 'archived_at'>>,
) => api.patch<AdminCategory>(`/admin/categories/${encodeURIComponent(categoryId)}`, input);

/** Archives — a linked landing page keeps resolving. */
export const archiveCategory = (categoryId: string) =>
  api.delete<void>(`/admin/categories/${encodeURIComponent(categoryId)}`);

export type AdminAnnouncement = {
  id: string;
  kind: AnnouncementKind;
  placement: Placement | 'all';
  title: string;
  body: string;
  link_path: string;
  link_label: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  dismissible: boolean;
  created_at: string;
  updated_at: string;
};

export const fetchAdminAnnouncements = () =>
  api.get<{ data: AdminAnnouncement[] }>('/admin/announcements');

export const createAnnouncement = (input: Partial<AdminAnnouncement>) =>
  api.post<AdminAnnouncement>('/admin/announcements', input);

export const updateAnnouncement = (id: string, input: Partial<AdminAnnouncement>) =>
  api.patch<AdminAnnouncement>(`/admin/announcements/${encodeURIComponent(id)}`, input);

export const deleteAnnouncement = (id: string) =>
  api.delete<void>(`/admin/announcements/${encodeURIComponent(id)}`);

/* -------------------------------------------------------------------------- */
/* Curated discovery lists                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Featured cities and popular searches.
 *
 * Both are CURATION, not derived data. Featured cities are not the platform's
 * city list — every city with an event is already searchable — they are the
 * handful shown on the front page. "Popular" searches are what an operator
 * wants to point people at; there is no query log, and a number invented from
 * nothing is what this codebase refuses to display.
 */

export type AdminFeaturedCity = {
  id: string;
  name: string;
  image_url: string;
  position: number;
  is_visible: boolean;
  created_at: string;
};

export type AdminPopularSearch = {
  id: string;
  label: string;
  /** What pressing the chip searches for — deliberately separate from `label`. */
  query: string;
  position: number;
  is_visible: boolean;
  created_at: string;
};

export const fetchAdminFeaturedCities = () =>
  api.get<{ data: AdminFeaturedCity[] }>('/admin/featured-cities');

export const createFeaturedCity = (input: {
  name: string;
  image_url?: string;
  position?: number;
  is_visible?: boolean;
}) => api.post<AdminFeaturedCity>('/admin/featured-cities', input);

export const updateFeaturedCity = (
  cityId: string,
  input: Partial<Omit<AdminFeaturedCity, 'id' | 'created_at'>>,
) => api.patch<AdminFeaturedCity>(`/admin/featured-cities/${encodeURIComponent(cityId)}`, input);

export const deleteFeaturedCity = (cityId: string) =>
  api.delete<void>(`/admin/featured-cities/${encodeURIComponent(cityId)}`);

export const fetchAdminPopularSearches = () =>
  api.get<{ data: AdminPopularSearch[] }>('/admin/popular-searches');

export const createPopularSearch = (input: {
  label: string;
  query: string;
  position?: number;
  is_visible?: boolean;
}) => api.post<AdminPopularSearch>('/admin/popular-searches', input);

export const updatePopularSearch = (
  searchId: string,
  input: Partial<Omit<AdminPopularSearch, 'id' | 'created_at'>>,
) =>
  api.patch<AdminPopularSearch>(`/admin/popular-searches/${encodeURIComponent(searchId)}`, input);

export const deletePopularSearch = (searchId: string) =>
  api.delete<void>(`/admin/popular-searches/${encodeURIComponent(searchId)}`);
