import type { Metadata } from 'next';

export { SITE_URL } from '@/lib/api/config';
import { SITE_URL } from '@/lib/api/config';
import { BRAND_NAME } from '@/lib/brand';

/**
 * Re-exported from `lib/brand` rather than declared here.
 *
 * It was a literal — `'Event & Experience Platform'` — which meant the
 * `<title>` template on EVERY page, the OpenGraph `site_name` on every share
 * and the `applicationName` in the install prompt all named a product that no
 * longer exists anywhere else in the codebase. `lib/brand.ts` was created
 * precisely to stop that (its own docstring says the name "was spelled out as a
 * literal in 26 files, which is why renaming it was a sweep — and a sweep
 * always misses one"). This is the one it missed, and it was the most visible
 * of the 26.
 */
export const SITE_NAME = BRAND_NAME;
const SITE_DESCRIPTION =
  'Discover events and experiences, book tickets in seconds, and get in with a single scan.';

/** App-wide metadata defaults (title template, OpenGraph, Twitter, robots). */
export const defaultMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Discover & book live events`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — Discover & book live events`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Discover & book live events`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/** Per-page metadata helper — merges a page title/description into the defaults. */
export function pageMetadata(title: string, description?: string): Metadata {
  return {
    title,
    description: description ?? SITE_DESCRIPTION,
    openGraph: { title, description: description ?? SITE_DESCRIPTION },
    twitter: { title, description: description ?? SITE_DESCRIPTION },
  };
}
