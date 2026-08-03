'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorScreen, useLoggedError } from '@/components/illustrations/error-screen';
import { SceneError } from '@/components/illustrations/scenes';

/**
 * The ROOT error boundary.
 *
 * ── WHAT ACTUALLY REACHES THIS FILE ──────────────────────────────────────
 *
 * Less than it looks, and that is the point of the sibling boundaries added
 * alongside it. An `error.tsx` catches everything BELOW it except its own
 * segment's layout, so with `(site)`, `(admin)`, `(organizer)` and
 * `(performer)` each carrying one, a crash inside a portal is now caught by
 * that portal's boundary — with that portal's copy and its own "home".
 *
 * What lands HERE is the narrow band the group boundaries cannot catch: a throw
 * inside a route group's own `layout.tsx` (SiteLayout's announcements fetch,
 * AdminShell, DashboardShell), and anything rendered directly under `app/`.
 * That is why this one is chrome-less and generic: by the time it runs, the
 * shell that would have told you which product you were in is the casualty.
 *
 * Before this pass there were exactly two route files in all of `app/` — this
 * and `not-found` — so a crash in the admin console rendered the consumer
 * site's error page. It still would have "worked"; it just told an operator
 * mid-incident to go and browse some events.
 */
export default function RootError({
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
      title="Something went wrong"
      message="This page hit an unexpected error. Trying again usually works — if it keeps happening, it's on us to fix."
      onRetry={reset}
      digest={error.digest}
      secondary={
        <Button asChild variant="ghost">
          <Link href="/events">Browse events</Link>
        </Button>
      }
    />
  );
}
