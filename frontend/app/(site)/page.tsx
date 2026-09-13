import * as React from 'react';
import type { Metadata } from 'next';
import { HomeBody } from '@/components/discovery/home-body';
import { PUBLIC_LIST_REVALIDATE_SECONDS } from '@/lib/api/events';
import { JsonLd, webSiteJsonLd } from '@/lib/seo/json-ld';
import { SITE_NAME, SITE_URL, pageMetadata } from '@/lib/seo/metadata';

/**
 * The landing page, on its public URL.
 *
 * The sections themselves are `HomeBody`, which the organizer dashboard also
 * renders at `/dashboard/home` — an organizer pressing Home in their bottom
 * bar stays inside the product instead of being handed to the attendee shell.
 * One arrangement of those nine blocks, two mounts.
 *
 * What stays HERE is everything that is a claim about this URL: the canonical,
 * the page metadata and the `WebSite` structured data. The dashboard copy is
 * `noindex` and must never tell a crawler it is the same document.
 *
 * ── STILL STATIC + ISR ────────────────────────────────────────────────────
 *
 * Nothing here is per-visitor (the location prompt swaps on the client), so a
 * CDN serves identical HTML to everyone. The interval matches the backend's
 * own `s-maxage=30` on `GET /events`, so the page, the Next data cache and the
 * edge age on one clock rather than three.
 */
export const revalidate = PUBLIC_LIST_REVALIDATE_SECONDS;

export const metadata: Metadata = {
  ...pageMetadata(
    'Discover live events, or hire a band',
    'Concerts, comedy, workshops, sports and festivals — plus bands, DJs and performers for your own wedding, party or corporate event. No account needed to browse.',
  ),
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={webSiteJsonLd({
          name: SITE_NAME,
          url: SITE_URL,
          searchUrlTemplate: `${SITE_URL}/events?q={search_term_string}`,
        })}
      />
      <HomeBody />
    </>
  );
}
