import * as React from 'react';
import type { Metadata } from 'next';
import { DashboardShell } from '@/components/organizer/dashboard-shell';

export const metadata: Metadata = {
  title: { default: 'Dashboard', template: '%s · Curatix for organizers' },
  // Nothing under here is public, and none of it should ever be indexed.
  robots: { index: false, follow: false },
};

/**
 * The organizer dashboard's route group.
 *
 * Its OWN group, so it inherits none of the attendee site's header, footer,
 * bottom nav, cookie banner, search overlay or location provider — an
 * organizer needs the viewport for tables, and none of that chrome is theirs.
 * The one thing it shares is the root layout's providers (theme, auth, query
 * client), which is exactly what should be shared.
 */
export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
