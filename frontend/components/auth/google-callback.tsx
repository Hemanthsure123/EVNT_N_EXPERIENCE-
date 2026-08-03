'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { safeNext } from './safe-next';

/**
 * Where Google's callback lands the browser.
 *
 * The backend has already done everything that matters — verified the state,
 * exchanged the code, validated the id_token, found or created the user, and
 * minted a session. What arrives here is a ONE-TIME HANDOFF CODE standing in
 * for that session, because putting tokens in a redirect URL would leave a
 * full session in server logs (query string) or browser history (fragment).
 *
 * So this page has exactly one job: swap the handoff for the session and get
 * out of the way. It is not a destination — nobody should ever look at it for
 * more than a moment.
 */

const MESSAGES: Record<string, string> = {
  google_sign_in_cancelled: 'Sign-in was cancelled. You can try again whenever you like.',
  google_account_unverified:
    "That Google account's email address isn't verified with Google, so it can't be used to " +
    'sign in. Verify it with Google, or sign in with your password.',
  oauth_state_invalid: 'That sign-in link expired or was already used. Please try again.',
  google_sign_in_unavailable: 'Google sign-in is not available on this deployment.',
  invalid_credentials: 'That account is not available. Please contact support.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-block px-4 text-center">
      {children}
    </main>
  );
}

/**
 * A TOP-LEVEL named export, not a property hung off `GoogleCallback`.
 *
 * React's client manifest records exported bindings, not attributes on them —
 * so a Server Component referencing `GoogleCallback.Pending` fails the build
 * with "Could not find the module ... in the React Client Manifest". Both
 * shells are used across the server/client boundary, so both must be exports.
 */
export function GoogleCallbackPending() {
  return (
    <Shell>
      {/* `role=status` so a screen reader announces the wait rather than
          landing on a page that appears empty. */}
      <div role="status" className="flex flex-col items-center gap-stack">
        <Loader2 className="size-8 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        <p className="text-body text-muted-foreground">Signing you in…</p>
      </div>
    </Shell>
  );
}

export function GoogleCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { completeGoogleSignIn } = useAuth();
  const [error, setError] = React.useState<string | null>(null);

  const handoff = params.get('handoff');
  const failure = params.get('error');
  const next = safeNext(params.get('next'), '/');

  // A ref, not state: React 18 runs effects twice in development, and a
  // handoff code is SINGLE USE — the second redemption would fail and show an
  // error on a sign-in that actually succeeded.
  const started = React.useRef(false);

  React.useEffect(() => {
    if (failure) {
      setError(MESSAGES[failure] ?? 'Sign-in failed. Please try again.');
      return;
    }
    if (!handoff) {
      setError('That sign-in link is incomplete. Please try again.');
      return;
    }
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        await completeGoogleSignIn(handoff);
        // `replace`, not `push`: the callback URL carries a spent handoff, and
        // leaving it in history means Back lands on a page that can only fail.
        router.replace(next);
      } catch {
        setError('We could not complete that sign-in. Please try again.');
      }
    })();
  }, [completeGoogleSignIn, failure, handoff, next, router]);

  if (!error) return <GoogleCallbackPending />;

  return (
    <Shell>
      <div className="flex flex-col items-center gap-stack">
        <span
          className="inline-flex size-12 items-center justify-center rounded-full bg-destructive-subtle text-destructive-subtle-foreground"
          aria-hidden
        >
          <AlertCircle className="size-6" />
        </span>
        <h1 className="text-h4">Sign-in didn&apos;t complete</h1>
        {/* `role=alert` so this is announced, not merely displayed. */}
        <p role="alert" className="text-body-sm text-muted-foreground">
          {error}
        </p>
      </div>
      <Button asChild className="w-full">
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>Back to sign in</Link>
      </Button>
    </Shell>
  );
}
