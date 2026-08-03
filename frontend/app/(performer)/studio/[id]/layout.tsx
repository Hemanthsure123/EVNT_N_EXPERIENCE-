import * as React from 'react';
import { StudioShell } from '@/components/performer/studio-shell';

/**
 * The act-scoped frame.
 *
 * A layout rather than a per-page wrapper, so switching sections keeps the
 * nav, the act switcher and the lead count mounted — and their queries warm.
 */
export default function ActLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return <StudioShell performerId={params.id}>{children}</StudioShell>;
}
