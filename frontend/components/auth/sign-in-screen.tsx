'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrandLockup } from '@/components/shell/brand-mark';
import { useAuth } from '@/lib/auth/auth-provider';
import { BRAND_NAME } from '@/lib/brand';
import { AuthPanel } from './auth-panel';
import { SignInArt } from './sign-in-art';
import { safeNext } from './safe-next';

/**
 * ── THE REASSURANCE BLOCK IS GONE ─────────────────────────────────────────
 *
 * Four benefit bullets ("QR tickets ready at the gate", "Checkout already
 * filled in", "Orders, receipts and refunds", "Refunds to your original card")
 * and a closing sentence explaining that browsing needs no account.
 *
 * All of it removed. Nobody arrives at a sign-in page undecided about whether
 * to have an account — they are here because they pressed Sign in, or because
 * a checkout sent them. Selling the account at that point is copy written for
 * a landing page, in a place where the only useful thing is the form.
 *
 * It also read as filler. Four short reassuring lines under a form, each
 * pairing an icon with a benefit phrase, is the exact shape of generated
 * marketing furniture — and a product that explains itself at every step reads
 * as one that is not sure it works. No comparable ticketing site does this.
 *
 * The page is now the mark, the form, and nothing else.
 */

/**
 * The standalone sign-in screen.
 *
 * ── ONE COLUMN, BECAUSE THE PAGE HAS ONE JOB ──────────────────────────────
 *
 * This was a two-column split: a bordered card beside a bare column of
 * benefits. Two problems, and they compounded.
 *
 * The columns were not PEERS — one was a surface with a border and padding,
 * the other was naked text floating in the page — so the eye read it as a
 * card with something spilled next to it rather than as a designed pair. And
 * the aside's "What an account gets you" heading sat at the same weight as
 * the form's own, so the page had two competing entry points and no single
 * place to start reading.
 *
 * A sign-in page is a single-task screen. The strongest structure for one is
 * a centred column with strict vertical rhythm: brand, then the form, then
 * reassurance, in descending visual weight. Benefits are SUPPORTING material
 * — they belong below the thing they support, styled quieter than it, not
 * beside it competing at the same size. That is still true at 1280: the answer
 * to a wide viewport on a one-task screen is not to invent a second column to
 * fill it.
 *
 * ── THE HEADING STAYS INSIDE THE PANEL ────────────────────────────────────
 *
 * Tempting to lift the `h1` up here for a tidier page shell. It is mode-aware:
 * the panel flips it to "Create your account" when you switch to register, and
 * flips the subheading with it. A heading hoisted out of the panel would freeze
 * at "Welcome back" above a registration form.
 *
 * ── THE CARD IS THE ONLY OBJECT ON THE PAGE ──────────────────────────────
 *
 * On a pure-white canvas a white card cannot separate by value, so it does it
 * the way the light-first system does everywhere: a hairline plus a shadow. The
 * card gets `shadow-md` rather than the `shadow-sm` a list card gets, because
 * it is the single thing on the screen and it should visibly float. The mark
 * above it and the reassurance below it sit flat on the canvas with no surface
 * at all, so nothing competes with it.
 *
 * ── AND IT HAS A LID ─────────────────────────────────────────────────────
 *
 * `SignInArt` is a sunken band across the top of that card carrying a drawn
 * ticket. It is the page's ONLY decoration and its only colour, and it is the
 * reason the screen reads as a ticketing product rather than as any login form
 * ever made. `overflow-hidden` on the card is what clips it into the top two
 * corners — without it the band's square top would poke out of the radius.
 *
 * It is short (80px) on a phone and grows at `sm`, because on a phone the form
 * IS the page: at 360x640 the email field still lands above the fold with the
 * band in place, which is the constraint the band was sized against rather than
 * a number that looked nice on a monitor.
 *
 * ── THE BENEFIT GLYPHS ARE INK, NOT VIOLET ───────────────────────────────
 *
 * They were `text-primary`. The funnel's copy of this list
 * (`components/booking/step-login.tsx`) had already moved to tertiary ink on
 * the grounds that the light-first language spends its wayfinding violet on a
 * handful of jobs and a row of reassurances is not one of them — and the two
 * surfaces disagreeing about it is exactly the drift that sharing `AuthPanel`
 * exists to prevent. The violet on this page is now spent in one place: the art.
 *
 * `useSearchParams` is why this is a client component and why the route is not
 * prerendered — acceptable (a sign-in page is never a static-HTML win) and
 * contained to this one route rather than the whole layout.
 */
export function SignInScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useAuth();
  const next = safeNext(params?.get('next'));

  // Already signed in — this page has nothing to do. `replace`, so Back doesn't
  // bounce between here and wherever they were.
  React.useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, router, next]);

  return (
        // `gap-block`, not `gap-section`: 40px between a wordmark and the card it
    // sits above is page rhythm applied to two things that belong together.
    <div className="flex w-full max-w-md flex-col gap-block">
      {/* The mark, not a second wordmark in the header's size. On the front
          door of an account it answers "whose sign-in is this" before the
          form asks for a password — which is the question a phishing page
          cannot answer honestly. */}
      <Link
        href="/"
        aria-label={`${BRAND_NAME} home`}
        // `min-h-control` + horizontal padding: the mark is 36px tall, which is
        // under the 44px touch floor for what is a real navigation target.
        className="inline-flex min-h-control items-center justify-center gap-2 self-center rounded-md px-2 transition-opacity duration-fast hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <BrandLockup />
      </Link>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
        <SignInArt />
        <div className="p-card sm:p-card-lg md:p-8">
          <AuthPanel
            heading="Welcome back"
            subheading="Sign in to see your tickets and pick up where you left off."
            next={next}
            onAuthenticated={() => router.replace(next)}
          />
        </div>
      </div>
    </div>
  );
}
