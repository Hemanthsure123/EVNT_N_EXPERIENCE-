'use client';

import * as React from 'react';
import { ErrorScreen, useLoggedError } from '@/components/illustrations/error-screen';
import { SceneError } from '@/components/illustrations/scenes';

/**
 * The operator console's error boundary.
 *
 * ── WHY THIS FILE HAD TO EXIST ───────────────────────────────────────────
 *
 * Without it, a crash anywhere under `/admin` fell through to `app/error.tsx`,
 * which — before this pass — was the CONSUMER site's error page. An operator
 * working an incident got a "Browse events" button. The console is a separate
 * product with its own audience; it gets its own failure screen and its own way
 * back, which is `/admin` and not the marketing homepage.
 *
 * ── IT DELIBERATELY HAS NO SIDEBAR ───────────────────────────────────────
 *
 * A boundary is NOT wrapped by a layout that lives below it, and `AdminShell`
 * is mounted in `app/(admin)/admin/layout.tsx` — one segment deeper than this
 * file. So this renders bare, with the full viewport.
 *
 * That is the correct place for it rather than an oversight. The console is
 * client-rendered end to end and the shell is what mounts the guard, the ⌘K
 * palette and the notification centre; if the failure IS the shell, drawing
 * chrome around the error would mean re-rendering the thing that just threw.
 * A boundary that can be taken down by the same bug it is reporting is not a
 * boundary.
 *
 * ── NO OFFLINE BRANCH HERE, UNLIKE `(site)` ──────────────────────────────
 *
 * The console has no offline story to tell: every one of its endpoints is
 * `private, no-store` and nothing is cached, so there is no "what you were
 * looking at is still here" to promise. An operator who has lost connectivity
 * needs the same sentence and the same retry either way, and a second screen
 * that says less would be worse.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useLoggedError(error);

  return (
    <ErrorScreen
      scene={<SceneError className="h-40 w-auto sm:h-48" />}
      title="The console hit an error"
      message="This screen failed to load. Retrying re-renders just this view, without reloading the console."
      onRetry={reset}
      homeHref="/admin"
      homeLabel="Back to the console"
      digest={error.digest}
    />
  );
}
