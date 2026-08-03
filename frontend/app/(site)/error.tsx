'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ErrorScreen, useLoggedError } from '@/components/illustrations/error-screen';
import { SceneError, SceneOffline } from '@/components/illustrations/scenes';
import { useOnline } from '@/lib/utils/use-online';

/**
 * The consumer site's error boundary.
 *
 * ── IT RENDERS INSIDE THE SITE SHELL, WHICH IS THE WHOLE POINT ───────────
 *
 * A boundary is wrapped by its own segment's layout, so this one keeps the
 * header, the footer and the bottom nav. That is not decoration: a failed event
 * page with the site chrome still around it is a page with a search field, a
 * city switcher and a nav — half a dozen ways forward — where the same failure
 * caught by the root boundary is a blank screen with two buttons on it. Hence
 * `layout="inset"`: the shell already owns the viewport, and `min-h-dvh` here
 * would push the footer a full screen below the fold.
 *
 * ── OFFLINE AND BROKEN ARE DIFFERENT SCREENS ─────────────────────────────
 *
 * A fetch that fails because the train went into a tunnel throws exactly like a
 * fetch that fails because our API is down, and rendering "something went
 * wrong" for the first one sends somebody to look for a status page over thirty
 * seconds of missing signal. `useOnline()` is the only thing that can tell them
 * apart from in here, and it is SSR-safe (optimistic until the client says
 * otherwise), so this never flashes "you're offline" at a reader who is not.
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useLoggedError(error);
  const online = useOnline();

  if (!online) {
    return (
      <ErrorScreen
        layout="inset"
        scene={<SceneOffline className="h-40 w-auto sm:h-48" />}
        title="You're offline"
        message="We couldn't reach Curatix. Check your connection — everything you were looking at is still here."
        onRetry={reset}
        retryLabel="Try again"
        // No digest: nothing failed at our end, so quoting a reference to
        // support would send somebody to ask about an error that never
        // happened here.
      />
    );
  }

  return (
    <ErrorScreen
      layout="inset"
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
