import type { Metadata } from 'next';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const SITE_NAME = 'Event & Experience Platform';
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
