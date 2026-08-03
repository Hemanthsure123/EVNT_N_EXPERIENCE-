import * as React from 'react';
import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';

/**
 * The operator console.
 *
 * Its own route group, so it does NOT inherit the attendee site's header,
 * footer or bottom nav — an admin needs the full viewport for tables, and a
 * "Browse events" nav bar above a payouts screen is noise.
 *
 * Everything below is client-rendered on purpose. Each `/admin/*` endpoint is
 * staff-only and `private, no-store`, so there is nothing a server render could
 * usefully fetch: it has no operator token, and any response it produced could
 * not be cached anyway. Rendering in the browser also means the guard resolves
 * once, in one place.
 */
export const metadata: Metadata = {
  title: 'Console',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
