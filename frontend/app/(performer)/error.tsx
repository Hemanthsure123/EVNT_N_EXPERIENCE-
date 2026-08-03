'use client';

import * as React from 'react';
import { ErrorScreen, useLoggedError } from '@/components/illustrations/error-screen';
import { SceneError } from '@/components/illustrations/scenes';

/**
 * The Performer Studio's error boundary. "Home" is `/studio`, the act picker —
 * not `/studio/[id]`, because a crash scoped to one act is exactly the case
 * where sending somebody back INTO that act loops them through the same failure.
 *
 * ── THE ONE THING THIS COPY HAS TO SAY ───────────────────────────────────
 *
 * The studio's profile editor AUTOSAVES against `Performer.version`, so the
 * question a performer has when the screen vanishes mid-edit is "did I just
 * lose the bio I was writing". The answer is that a save either landed before
 * the crash or did not; the editor holds one save in flight and queues a
 * trailing one, so nothing half-wrote. Saying so is worth more than a retry
 * button, because the retry is obvious and the anxiety is not.
 *
 * Careful not to over-promise: this does NOT claim the last keystrokes were
 * saved. It says the record is intact, which is the part that is true.
 */
export default function PerformerError({
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
      title="The studio hit an error"
      message="Something went wrong drawing this screen. Your act's saved profile is intact — anything typed since the last autosave may need retyping."
      onRetry={reset}
      homeHref="/studio"
      homeLabel="Back to my acts"
      digest={error.digest}
    />
  );
}
