'use client';

import * as React from 'react';
import { useScope, type Organization } from '@/lib/identity/scope';

/**
 * WHICH organisation a management screen is acting for.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * Both crew surfaces resolved it as `organizations.data?.data?.[0]` — the
 * first row of an unordered list. The dashboard has had a scope switcher the
 * whole time, so an account owning two companies could pick the second one in
 * the header and then add a crew member, upload their photograph and put them
 * on a lineup, all against the FIRST one. Nothing errors: every write is valid,
 * the roster reads back correctly, and the person simply appears under a brand
 * they were never meant to be attached to. The switcher says one thing and the
 * screen does another.
 *
 * `useScope().active` is the switcher's own answer and is verified against the
 * live list rather than trusted from `localStorage`, so a stale stored id (an
 * organisation transferred away, or deleted) falls back rather than resolving
 * to somebody else's company.
 *
 * ── WHEN THE SWITCHER SAYS "PERSONAL" ─────────────────────────────────────
 *
 * A management screen still needs an organisation. Exactly one owned company
 * is adopted, because there is no ambiguity to resolve and making somebody
 * flip a switcher to reach the only roster they have is friction with no
 * decision behind it. More than one is a real question and is returned as
 * `needsChoice`, so the caller asks rather than picking — the same rule the
 * event wizard already follows for `organizationId`, and for the same reason:
 * a guess here attaches real records to the wrong brand.
 */
export type ActiveOrganization = {
  /** The organisation to act for, or `null` while unresolved or ambiguous. */
  organization: Organization | null;
  /** Every organisation this account owns — for a picker, when one is needed. */
  organizations: readonly Organization[];
  /** True once auth AND the organization list have both resolved. */
  ready: boolean;
  /** Owns several and has not chosen: the caller must ask. */
  needsChoice: boolean;
  /** Owns none at all — a different, earlier problem than `needsChoice`. */
  hasNone: boolean;
  /** Switch the dashboard-wide scope, so the header and the screen agree. */
  choose: (organization: Organization) => void;
};

export function useActiveOrganization(): ActiveOrganization {
  const { active, organizations, ready, switchTo } = useScope();

  const organization = React.useMemo(() => {
    if (active.kind === 'organization') return active.organization;
    return organizations.length === 1 ? organizations[0] : null;
  }, [active, organizations]);

  const choose = React.useCallback(
    (next: Organization) => switchTo({ kind: 'organization', organization: next }),
    [switchTo],
  );

  return {
    organization,
    organizations,
    ready,
    needsChoice: ready && !organization && organizations.length > 1,
    hasNone: ready && organizations.length === 0,
    choose,
  };
}
