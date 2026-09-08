import { api } from './client';

/**
 * Categories, of which there are two kinds and the difference matters.
 *
 * ── GLOBAL VS ORGANIZER ──────────────────────────────────────────────────
 *
 * A GLOBAL category is the browse taxonomy: nine closed slugs that the landing
 * pages are built from, that `event_status_category_idx` indexes, and that the
 * bundled illustration set draws a scene per. It writes to `Event.category`.
 *
 * An ORGANIZER category is a label somebody typed for their own events. It is
 * scoped to their organization, never appears in anyone else's list, and never
 * reaches a browse filter. It writes to `Event.custom_category` — a foreign key
 * to a row, so renaming the category follows every event that carries it.
 *
 * The two are NOT interchangeable and the picker payload says which is which
 * on every row (`source`). Sending a custom slug as `category` is a 400 the
 * client would have no way to explain, which is exactly what the discriminator
 * exists to prevent.
 */

export type CategorySource = 'global' | 'organizer';

export type PickerCategory = {
  /** `null` for a global row — there is no table behind it. */
  id: string | null;
  slug: string;
  label: string;
  /**
   * Blank for every global row. Their artwork is BUNDLED, keyed on `slug`, so
   * there is no stored asset to point at and the client draws its own. A
   * custom category has no bundled scene and can never have one, which is the
   * whole reason the column exists.
   */
  image_url: string;
  image_alt_text: string;
  source: CategorySource;
  is_active: boolean;
};

export type OrganizerCategory = {
  id: string;
  label: string;
  slug: string;
  image_url: string;
  image_alt_text: string;
  is_active: boolean;
  created_at: string;
};

const base = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}/categories`;

/**
 * Everything this organizer may choose from, global and their own, in ONE call.
 *
 * One request rather than two because the picker cannot render a useful half:
 * showing the global tiles while somebody's own labels are still in flight is a
 * list that changes under the cursor of the person choosing from it.
 */
export const fetchCategoryPicker = (organizationId: string) =>
  api.get<{ data: PickerCategory[] }>(`${base(organizationId)}/picker`).then((page) => page.data);

/** The management list — includes retired rows, so they can be brought back. */
export const fetchOrganizerCategories = (
  organizationId: string,
  options?: { activeOnly?: boolean },
) =>
  api
    .get<{ data: OrganizerCategory[] }>(
      `${base(organizationId)}${options?.activeOnly ? '?active_only=true' : ''}`,
    )
    .then((page) => page.data);

/**
 * Save what the organizer typed.
 *
 * TYPING THE SAME WORD TWICE RETURNS THE ROW THEY ALREADY HAVE rather than
 * failing — the server resolves it that way on purpose, because a 409 on a
 * free-text box in the middle of a wizard is a dead end that teaches nothing
 * and the outcome the caller asked for is already true. So a caller does not
 * need to check for an existing label first.
 *
 * The slug is DERIVED server-side and is not accepted here: it is the
 * uniqueness key within the organization, and a client-set one would be a
 * second source of truth for it.
 */
export const createOrganizerCategory = (organizationId: string, label: string) =>
  api.post<OrganizerCategory>(base(organizationId), { label });

export const updateOrganizerCategory = (
  organizationId: string,
  categoryId: string,
  changes: { label?: string; is_active?: boolean },
) => api.patch<OrganizerCategory>(`${base(organizationId)}/${encodeURIComponent(categoryId)}`, changes);

/**
 * Retire a category.
 *
 * Refused with a `409 organizer_category_in_use` while any event carries it —
 * `Event.custom_category` is `PROTECT`ed. The message names the alternative
 * (deactivate), so surface it verbatim rather than replacing it.
 */
export const deleteOrganizerCategory = (organizationId: string, categoryId: string) =>
  api.delete<void>(`${base(organizationId)}/${encodeURIComponent(categoryId)}`);
