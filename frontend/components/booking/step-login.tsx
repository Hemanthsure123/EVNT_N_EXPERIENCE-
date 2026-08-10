'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { History, ShieldCheck, Ticket, Zap } from 'lucide-react';
import { AuthPanel } from '@/components/auth/auth-panel';
import { useAuth } from '@/lib/auth/auth-provider';
import { SELECTION_PARAM, serialiseSelection } from '@/lib/booking/selection';
import { useBooking } from './booking-context';
import { Rise, StepTransition } from './motion';

/**
 * Step 2 — sign in, only when there is no session.
 *
 * ── ONE COLUMN, BECAUSE THE PAGE ALREADY HAS TWO ──────────────────────────
 *
 * This step used to split its own column again — the form beside a bordered
 * "Why an account, for a ticket?" card — inside a shell that ALREADY puts the
 * order summary in a second column. Three cards across, at three different
 * widths, none of them the obvious place to start.
 *
 * It is the same mistake `components/auth/sign-in-screen.tsx` documents and
 * fixed on the standalone route: benefits are SUPPORTING material, so they go
 * below the thing they support, styled quieter — not beside it in a surface of
 * equal weight, competing for the same attention. Both surfaces now render the
 * same form at the same width in the same order, which is the point of them
 * sharing a component at all.
 *
 * ── THE DEAD POSTER BOX IS GONE ───────────────────────────────────────────
 *
 * The card led with an `aspect-card` image well that fell back to a grey
 * gradient. Most events in this catalogue have no `poster_url`, so in practice
 * it rendered a large empty rectangle as the first thing on the screen — and
 * the summary beside it was already showing the event. An empty frame is worse
 * than no frame: it reads as an image that failed to load.
 *
 * ── THE BENEFIT ICONS ARE INK, NOT ACCENT ─────────────────────────────────
 *
 * They were `text-primary`: four violet glyphs on the one screen in the funnel
 * that has no primary action of its own (the form owns it). The light-first
 * language spends the wayfinding violet on a handful of jobs — the search
 * icon, an event's date, the hold timer's tint — and a list of reassurances is
 * not one of them. Tertiary ink says the same thing without claiming the eye.
 *
 * ── EVERYTHING ELSE IS UNCHANGED ──────────────────────────────────────────
 *
 * The form is `components/auth/auth-panel` — the SAME component `/sign-in`
 * renders, so the two cannot drift, and its buttons are that component's to
 * restyle rather than this one's. Guest checkout is still deliberately absent:
 * issuing a ticket requires a user to issue it to. Signing in REPLACES this
 * history entry, so Back from review returns to the EVENT PAGE — where the
 * tickets were chosen — rather than to a sign-in screen that would bounce
 * forward again.
 */

const BENEFITS = [
  { icon: Ticket, label: 'QR tickets ready at the gate' },
  { icon: Zap, label: 'Checkout already filled in' },
  { icon: History, label: 'Orders, receipts and refunds' },
  { icon: ShieldCheck, label: 'Refunds to your original card' },
];

export function LoginStep() {
  const { event, selection } = useBooking();
  const { status } = useAuth();
  const router = useRouter();

  const query = selection.length ? `?${SELECTION_PARAM}=${serialiseSelection(selection)}` : '';
  const reviewHref = `/booking/${event.id}/review${query}`;

  // Already signed in — never show this screen. Someone who signs in on another
  // tab, or arrives with a session, goes straight on.
  React.useEffect(() => {
    if (status === 'authenticated') router.replace(reviewHref);
  }, [status, router, reviewHref]);

  return (
    <StepTransition stepKey="login">
      {/* Capped to a form-comfortable width and sharing ONE left edge with the
          heading and the reassurance under it. The funnel's content column is
          ~830px at lg; a password field that wide is a worse form, and the
          whitespace beside it is what makes the summary read as the second
          column rather than as a third card. */}
      <div className="flex w-full max-w-xl flex-col gap-block-lg">
        <Rise>
          <header className="flex flex-col gap-stack">
            <h1 className="text-h2 md:text-h1">Almost there</h1>
            <p className="text-body text-muted-foreground">
              Sign in to put the tickets in your name — they stay held while you do.
            </p>
          </header>
        </Rise>

        <Rise index={1}>
          <div className="rounded-2xl border border-border bg-surface p-card-lg shadow-md md:p-8">
            <AuthPanel next={reviewHref} onAuthenticated={() => router.replace(reviewHref)} />
          </div>
        </Rise>

        <Rise index={2}>
          {/* Two columns at sm+ so four short lines read as one block instead
              of a list long enough to push the form off a phone screen. */}
          <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.label} className="flex items-start gap-2.5">
                <benefit.icon
                  className="mt-0.5 size-4 shrink-0 text-foreground-subtle"
                  aria-hidden
                />
                <span className="text-body-sm text-muted-foreground">{benefit.label}</span>
              </li>
            ))}
          </ul>
        </Rise>
      </div>
    </StepTransition>
  );
}
