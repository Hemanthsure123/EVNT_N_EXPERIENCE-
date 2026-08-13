'use client';

import * as React from 'react';
import {
  ErrorScreen,
  useChunkRecovery,
  useLoggedError,
} from '@/components/illustrations/error-screen';
import { SceneError } from '@/components/illustrations/scenes';

/**
 * The organizer dashboard's error boundary.
 *
 * Its own file for the same reason `(admin)` has one: without it, an organizer
 * whose payouts screen crashed was handed the consumer site's error page and a
 * link to browse events. "Home" here is `/dashboard`.
 *
 * Like the admin boundary, this sits one segment ABOVE `DashboardShell` (which
 * mounts in `app/(organizer)/dashboard/layout.tsx`), so it renders bare. That is
 * deliberate: if the shell is what threw, re-rendering it around the error
 * message would take the error message down with it.
 *
 * The copy names the one thing an organizer will actually worry about when a
 * screen disappears mid-task — whether their event or their money moved. It did
 * not: everything under here except the event editor is a READ surface, and the
 * boundary catches a render, not a write that was already sent.
 */
export default function OrganizerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useLoggedError(error);

  // A deploy-stale script chunk is the one failure here that no retry button
  // can fix — the code this document names is gone — and it is what produced
  // the "works after refreshing a few times" reports. Recovering silently is
  // right for exactly that case; everything else still gets the screen below,
  // because an error somebody could report is worth showing.
  if (useChunkRecovery(error)) return null;

  return (
    <ErrorScreen
      scene={<SceneError className="h-40 w-auto sm:h-48" />}
      title="This screen didn't load"
      message="Something went wrong displaying your dashboard. Your events, bookings and payouts are unaffected — this is a problem drawing the page."
      onRetry={reset}
      homeHref="/dashboard"
      homeLabel="Back to the dashboard"
      digest={error.digest}
    />
  );
}
