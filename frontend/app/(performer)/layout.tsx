import * as React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s · Curatix for performers' },
  // A workspace, not a page. None of it should ever be indexed.
  robots: { index: false, follow: false },
};

/**
 * The Performer Studio's route group.
 *
 * Its own group for the same reason the organizer dashboard has one: it
 * inherits none of the attendee site's header, footer, bottom nav, cookie
 * banner or search overlay, but does inherit the root layout's providers
 * (theme, auth, query client) — which is exactly the split that should exist.
 *
 * The shell itself lives under `[id]`, because every screen in this workspace
 * is scoped to one act and the index has no act to scope to.
 */
export default function PerformerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
