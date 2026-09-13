import * as React from 'react';
import type { Metadata } from 'next';
import { DiscoveryProviders } from '@/components/discovery/discovery-providers';
import { HomeBody } from '@/components/discovery/home-body';
import { fetchHomepageSafe } from '@/lib/api/cms';
import { browseHref } from '@/lib/discovery/filters';

/**
 * THE LANDING PAGE, INSIDE THE ORGANIZER DASHBOARD.
 *
 * ── THE BUG THIS ROUTE EXISTS TO FIX ─────────────────────────────────────
 *
 * Home in the organizer's bottom bar pointed at `/`. That is a different route
 * GROUP, so pressing it swapped the whole shell: the attendee header, footer
 * and the four-tab public bar (Home, Events, Saved, Hire) replaced the
 * organizer's own. The navigation changing under them is the product telling
 * somebody they have left it — which is not what "show me the landing page"
 * means.
 *
 * So the landing page is rendered HERE, under `app/(organizer)/dashboard`,
 * which means the dashboard layout wraps it: the Curatix header stays, the
 * organizer's glass bottom bar stays, and Home is simply the tab that is
 * currently active. Nothing about the chrome moves.
 *
 * ── IT IS THE SAME PAGE, NOT A COPY OF IT ────────────────────────────────
 *
 * `HomeBody` is the one arrangement of those nine sections and `/` renders the
 * identical component. What `/` keeps is everything that is a CLAIM about that
 * URL — the canonical, the page metadata, the `WebSite` structured data. None
 * of it belongs here: this route is behind a login and the dashboard layout
 * already marks the whole group `noindex`, so a crawler is never told these
 * are the same document.
 *
 * ── AND IT BRINGS ITS OWN PROVIDERS ──────────────────────────────────────
 *
 * Every discovery card opens the mobile event deck, the location prompt reads
 * the shared city, and the search overlay wants the operator's popular terms.
 * All three live in the ATTENDEE layout, which this route group deliberately
 * does not inherit — so `DiscoveryProviders` mounts them, and is the same
 * component the site layout uses rather than a second stack that would drift.
 */
export const metadata: Metadata = { title: 'Home' };

export default async function OrganizerHomePage() {
  // Same read the site layout performs, for the same reason: the search panel
  // shows operator-curated terms rather than a number nobody measured. It
  // never throws — a failing upstream leaves the panel on its bundled list.
  const cms = await fetchHomepageSafe();
  const terms = (cms?.popular_searches ?? []).map((row) => ({
    label: row.label,
    href: browseHref({ q: row.query }),
  }));

  return (
    <DiscoveryProviders terms={terms}>
      <HomeBody />
    </DiscoveryProviders>
  );
}
