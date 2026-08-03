'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Paginated } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-provider';

/**
 * The active SCOPE: whose hat the signed-in person is currently wearing.
 *
 * ── ONE IDENTITY, MANY SCOPES ─────────────────────────────────────────────
 *
 * There is one account and one session. "Personal", "Acme Events" and
 * "Console" are not separate logins — they are different sets of permissions
 * on the same `/auth/me`. Switching therefore NEVER touches the token; it only
 * changes which navigation and which data the UI asks for. That is the whole
 * reason this is a client-side preference rather than a server round trip.
 *
 * ── WHY THE SCOPE IS REMEMBERED, AND WHY IT IS VERIFIED ───────────────────
 *
 * An organizer who works in one organization all day should land back in it.
 * But a remembered id is a CLAIM, not proof: an organization can be handed to
 * someone else, renamed, or soft-deleted between sessions. So the stored id is
 * resolved against the live list on every load, and silently falls back to
 * personal if it no longer resolves — never a broken header showing an
 * organization the API will refuse to serve.
 *
 * ── AVAILABLE SCOPES ARE DERIVED FROM DATA, NOT FROM A ROLE FLAG ──────────
 *
 * `GET /organizations/` returns exactly the organizations this person owns, so
 * the switcher cannot offer one they cannot use. `is_staff` on `/auth/me`
 * decides whether Console appears. Both are server truths; the menu is a
 * projection of them, never a source.
 */

const STORAGE_KEY = 'ee-active-scope';

/** What `GET /organizations/` returns — the SUMMARY serializer, not the
    detail one. `owner_id` and `payout_account_id` are deliberately absent
    here: the list is only ever the caller's own, so ownership is implied,
    and a payout account id has no business in a navigation menu. */
export type Organization = {
  id: string;
  name: string;
  logo_url: string;
  verified_level: 'unverified' | 'pending' | 'verified';
  created_at: string;
};

export type Scope = { kind: 'personal' } | { kind: 'organization'; organization: Organization };

export function useOrganizations() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['identity', 'organizations'],
    queryFn: () => api.get<Paginated<Organization>>('/organizations/'),
    // Only ask once there is a session — an anonymous call would 401 and the
    // retry would be noise on every public page.
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}

export function useScope() {
  const { user, isAdmin } = useAuth();
  const query = useOrganizations();
  const organizations = React.useMemo(() => query.data?.data ?? [], [query.data]);

  const [storedId, setStoredId] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  // Read after mount: the server has no localStorage, so reading during render
  // would be a hydration mismatch.
  React.useEffect(() => {
    try {
      setStoredId(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private mode. Personal scope is a fine default.
    }
    setReady(true);
  }, []);

  // The stored id is verified against the live list, never trusted.
  const active: Scope = React.useMemo(() => {
    if (!storedId) return { kind: 'personal' };
    const match = organizations.find((organization) => organization.id === storedId);
    return match ? { kind: 'organization', organization: match } : { kind: 'personal' };
  }, [storedId, organizations]);

  const switchTo = React.useCallback((next: Scope) => {
    const id = next.kind === 'organization' ? next.organization.id : null;
    setStoredId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not being able to remember it is not a reason to refuse the switch.
    }
  }, []);

  return {
    user,
    isAdmin,
    /** True once auth AND the organization list have both resolved. */
    ready: ready && !query.isPending,
    /**
     * Every organization this person owns, whatever its state — what the
     * "Host events" page lists, including the ones still awaiting review.
     */
    organizations,
    /**
     * An ORGANIZER is somebody an operator has APPROVED, not merely somebody
     * who filled in a form.
     *
     * This was `organizations.length > 0`, which made creating an
     * organization sufficient — so a brand-new, unverified, never-reviewed
     * account got the full organizer dashboard, the scope switcher and the
     * performer studio the moment it typed a name. The admin approval queue
     * existed and decided nothing.
     *
     * `verified` is the only level an operator can grant (`unverified` and
     * `pending` are both pre-decision), so it is the only one that unlocks
     * anything. The gate is enforced SERVER-SIDE on every endpoint that
     * matters — publishing, payouts, moderation — and this makes the
     * navigation agree with it instead of offering doors that 403.
     */
    isOrganizer: organizations.some((organization) => organization.verified_level === 'verified'),
    /** Owns at least one organization, approved or not — drives "your
        application is being reviewed" states rather than access. */
    hasOrganization: organizations.length > 0,
    active,
    switchTo,
  };
}

export function initialsOf(value: string): string {
  return (
    value
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}
