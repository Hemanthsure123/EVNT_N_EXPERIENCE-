import * as React from 'react';
import type { Metadata } from 'next';
import { Container } from '@/components/shell/container';
import { SignInScreen } from '@/components/auth/sign-in-screen';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = {
  ...pageMetadata(
    'Sign in',
    'Sign in to Curatix to see your tickets, order history and saved events.',
  ),
  alternates: { canonical: '/sign-in' },
  // A sign-in page has nothing to offer a crawler and everything to lose from
  // ranking above the pages people actually search for.
  robots: { index: false, follow: true },
};

/**
 * The standalone sign-in route.
 *
 * Separate from the booking funnel's step 2 on purpose — that one continues a
 * purchase in progress and keeps the summary card beside it; this one is the
 * front door for someone who came to check their tickets. They share the panel,
 * so there is exactly one auth implementation, and differ only in framing.
 *
 * `?next=` returns you where you were. It's validated as a same-origin path in
 * the screen component: an open redirect on a sign-in page is the classic
 * phishing primitive, and "we'll send you back where you came from" is exactly
 * the affordance it abuses.
 */
export default function SignInPage() {
  return (
    <Container className="flex justify-center py-12 md:py-16">
      {/* `SignInScreen` reads `?next=`, and `useSearchParams` without a
          boundary makes the whole route client-rendered at request time. The
          boundary keeps the shell (header, footer, this container) static and
          only defers the panel. */}
      <React.Suspense fallback={<SignInFallback />}>
        <SignInScreen />
      </React.Suspense>
    </Container>
  );
}

/**
 * Same column, same widths, same rhythm — so the panel arriving does not move
 * anything already painted. It mirrors the real screen's STRUCTURE (the art
 * band, then the padded body, then each control at its real height) rather than
 * being one grey box of a guessed height, which is what made the old fallback
 * shift the page the moment the form replaced it. When the card's shape changes,
 * this changes with it; a placeholder that has drifted from the thing it stands
 * in for is worse than none, because the jump it causes looks like a bug in the
 * form.
 */
function SignInFallback() {
  return (
    <div className="flex w-full max-w-md flex-col gap-section">
      {/* `h-control`, matching the real brand link's 44px touch-target floor. */}
      <div className="h-control w-40 self-center rounded-full bg-muted" aria-hidden />

      {/* Same hairline + `shadow-md` lift and the same sunken lid as the real
          card: on a white canvas the shadow IS the card, so a borderless
          placeholder would pop the moment the panel arrives. */}
      <div
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md"
        aria-hidden
      >
        <div className="h-20 border-b border-border bg-sunken sm:h-28" />
        <div className="flex flex-col gap-block p-card sm:p-card-lg md:p-8">
          <div className="flex flex-col gap-stack">
            <div className="h-8 w-2/3 rounded-md bg-muted" />
            <div className="h-5 w-full rounded-md bg-muted" />
          </div>
          <div className="h-control rounded-full bg-sunken" />
          <div className="flex flex-col gap-stack-lg">
            <div className="h-control w-1/2 rounded-full bg-muted" />
            <div className="flex flex-col gap-2">
              <div className="h-4 w-16 rounded-md bg-muted" />
              <div className="h-11 rounded-md bg-muted" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="h-4 w-20 rounded-md bg-muted" />
              <div className="h-11 rounded-md bg-muted" />
            </div>
            <div className="mt-1 h-control-lg rounded-full bg-muted" />
          </div>
        </div>
      </div>

      <div className="h-16 rounded-xl bg-sunken" aria-hidden />
      <span className="sr-only">Loading the sign-in form…</span>
    </div>
  );
}
