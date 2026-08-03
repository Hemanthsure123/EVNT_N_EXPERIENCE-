'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The one failure screen, rendered by every error and not-found boundary.
 *
 * ── WHY THERE IS A SHARED COMPONENT AT ALL ───────────────────────────────
 *
 * There are now eight boundaries: a global one, a root one, a 404, and one per
 * route group that has its own chrome. Eight hand-written centred columns is
 * eight chances for one of them to lose the retry button, print the raw error,
 * or drift to a different heading size — and a failure screen is the one
 * surface nobody looks at until it is already in front of a customer. One
 * component means the rules below hold everywhere by construction.
 *
 * ── WHY IT LIVES IN components/illustrations ─────────────────────────────
 *
 * Because the illustration IS the screen: everything else here is a heading, a
 * sentence and two controls. It sits beside `scenes.tsx` so the picture and the
 * frame it hangs in stay one decision.
 *
 * ── THE RULES, ALL FOUR ──────────────────────────────────────────────────
 *
 * 1. NEVER PRINT THE ERROR. `error.message` is written for a developer and
 *    routinely carries a file path, a query, an internal hostname or a
 *    stringified response body. It is logged to the console (which is where a
 *    developer already looks) and never rendered. What a person gets instead is
 *    one sentence in plain words about what happened to THEM.
 * 2. `digest` IS shown when Next provides one. It is an opaque hash Next mints
 *    precisely so a customer can quote it and support can find the server-side
 *    stack — it carries no content of its own, and without it a support
 *    conversation starts with "which error?".
 * 3. ALWAYS A WAY OUT, AND NEVER A DEAD END. `reset()` where the boundary gives
 *    one, a link home always. A failure screen whose only affordance is the
 *    browser's back button is how a session ends.
 * 4. NO SPINNER ON THE RETRY. `reset()` re-renders the segment synchronously;
 *    a loading state on it would be a spinner that is a lie about work being
 *    done somewhere.
 */

export type ErrorScreenProps = {
  /** The drawn scene. Passed in rather than chosen here, so the same frame
   *  serves 404 (a signpost), a crash (a cracked panel) and offline. */
  scene: React.ReactNode;
  title: string;
  /** One sentence, in plain words, about what happened to the reader. */
  message: string;
  /** Next's `reset` where the boundary has one; absent on `not-found`. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Where "home" is depends on which portal broke — `/admin`, `/dashboard`,
   *  `/studio` or `/`. Sending an operator to the consumer homepage is a
   *  small, daily insult from software that should know where they were. */
  homeHref?: string;
  homeLabel?: string;
  /** An optional second link (Browse events, Contact support…). */
  secondary?: React.ReactNode;
  /** Next's error digest, when the boundary has one. */
  digest?: string;
  /**
   * `standalone` fills the viewport — for boundaries that render with no
   * chrome around them (the root, the global one, every portal group). `inset`
   * sits inside an existing shell, where `min-h-dvh` would push the footer a
   * screen height below the fold.
   */
  layout?: 'standalone' | 'inset';
  className?: string;
};

export function ErrorScreen({
  scene,
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  homeHref = '/',
  homeLabel = 'Go home',
  secondary,
  digest,
  layout = 'standalone',
  className,
}: ErrorScreenProps) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-6 px-4 text-center',
        layout === 'standalone' ? 'min-h-dvh py-section' : 'py-section lg:py-section-lg',
        className,
      )}
    >
      {/* The scene is `aria-hidden` inside itself; the wrapper only sizes it.
          160-256px wide is the band these are drawn to read at — smaller and
          the character is a smudge, larger and it outweighs the sentence. */}
      <div className="w-full max-w-xs">{scene}</div>

      <div className="flex flex-col gap-3">
        <h1 className="text-h2">{title}</h1>
        <p className="text-body-sm text-muted-foreground">{message}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          // A real <button>, on the shared control height, so it clears the
          // 44px touch target on a phone — which is the device most likely to
          // be holding this screen.
          <Button onClick={onRetry}>{retryLabel}</Button>
        ) : null}
        <Button asChild variant={onRetry ? 'outline' : 'primary'}>
          <Link href={homeHref}>{homeLabel}</Link>
        </Button>
        {secondary}
      </div>

      {digest ? (
        <p className="text-caption text-foreground-subtle">
          Reference: <span className="font-mono tabular-nums">{digest}</span>
        </p>
      ) : null}
    </main>
  );
}

/**
 * The console.error every boundary owes its developer, in one place.
 *
 * Deliberately not a toast, a banner or a reporter call: there is no error
 * tracker wired in this codebase yet, and a `captureException` stub that goes
 * nowhere is worse than none — it reads, in review, as though errors are being
 * collected. When one is added, this is the single line that changes.
 */
export function useLoggedError(error: unknown) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
}
