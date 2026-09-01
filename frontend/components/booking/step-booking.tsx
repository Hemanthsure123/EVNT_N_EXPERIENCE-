'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mail, User as UserIcon } from 'lucide-react';
import { AuthSheet } from '@/components/auth/auth-sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { SELECTION_PARAM, serialiseSelection } from '@/lib/booking/selection';
import { formatFromPrice } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG } from './cta';
import { useBooking } from './booking-context';
import { Rise, StepTransition } from './motion';
import { StickyActionBar } from './sticky-action-bar';
import { TierPicker } from './tier-picker';
import { BOOKING_TRUST, TrustStrip } from './trust';

/**
 * Step 1 — choose tickets.
 *
 * WHERE THE CONTACT FORM WENT. The brief asks for name / email / phone here.
 * Two of those already exist and one cannot be stored: the ticket is issued to
 * the signed-in account and emailed there (that is what `notifications` does),
 * and `apps/accounts` exposes no way to write a profile — `/auth/me` is GET-only
 * and `phone` is not on the serializer at all. So this screen shows the account
 * the tickets will actually reach, instead of a form whose contents would be
 * silently discarded on submit. For a signed-out visitor it says where they will
 * land instead. BACKLOG.md item 17.
 *
 * The primary action says "Continue" and goes to the next step in the flow —
 * which is sign-in only when there is no session. None of that decision is
 * visible to someone already signed in.
 *
 * ONE BLACK PILL, ONE PLACE. The Continue button is the light-first language's
 * primary action — `--cta` fill, fully rounded, `px-pill-lg` wide — and it is
 * rendered EITHER in the desktop row (`lg` and up) OR in the mobile bar, never
 * both, so the screen has exactly one filled control at any width.
 */
export function BookingStep() {
  const { event, selection, totals, tiers } = useBooking();
  const { status, user } = useAuth();
  const router = useRouter();

  const chosen = totals.ticketCount > 0;
  const query = selection.length ? `?${SELECTION_PARAM}=${serialiseSelection(selection)}` : '';
  const reviewHref = `/booking/${event.id}/review${query}`;

  /**
   * ── SIGNING IN IS AN INTERRUPTION, NOT A STEP ──────────────────────────
   *
   * This used to push `/booking/{id}/login` — a whole screen for a thing that
   * is not part of buying a ticket, counted by the progress bar as a quarter
   * of the journey, and reached by leaving the selection behind and hoping it
   * survived the round trip.
   *
   * Now an anonymous press opens a sheet OVER this screen. The tickets stay
   * chosen and stay visible behind the scrim, and the moment a session exists
   * the flow continues to review from exactly where it paused.
   */
  const [authOpen, setAuthOpen] = React.useState(false);
  const advance = () => {
    if (status === 'authenticated') router.push(reviewHref);
    else setAuthOpen(true);
  };

  return (
    <StepTransition stepKey="booking" className="flex flex-col gap-section">
      <Rise>
        <header className="flex flex-col gap-stack">
          <h1 className="text-h2 md:text-h1">Choose your tickets</h1>
          <p className="text-body text-muted-foreground">
            Availability updates live. Nothing is held until you reach the review step.
          </p>
        </header>
      </Rise>

      <Rise index={1}>
        <TierPicker />
      </Rise>

      {tiers.length ? (
        <Rise index={2}>
          <section className="flex flex-col gap-stack-lg" aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-h3">
              Where your tickets go
            </h2>
            {status === 'authenticated' && user ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-card shadow-sm lg:p-card-lg">
                <p className="flex items-center gap-2.5 text-body-sm text-foreground">
                  <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {user.full_name || 'Your account'}
                </p>
                <p className="flex items-center gap-2.5 text-body-sm text-foreground">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {user.email}
                </p>
                <p className="text-caption text-muted-foreground">
                  Your QR tickets are emailed here the moment payment is confirmed.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-sunken p-card lg:p-card-lg">
                <p className="text-body-sm text-foreground">
                  Tickets are issued to your Curatix account.
                </p>
                <p className="text-caption text-muted-foreground">
                  You&apos;ll sign in or create one on the next step — it takes a moment, and it is
                  what lets us deliver the QR codes and keep your order history.
                </p>
              </div>
            )}
          </section>
        </Rise>
      ) : null}

      <Rise index={3}>
        <TrustStrip marks={BOOKING_TRUST} />
      </Rise>

      {totals.overAvailable ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive-subtle bg-destructive-subtle p-card text-body-sm text-destructive-subtle-foreground"
        >
          Some tiers no longer have that many left — adjust the quantities to continue.
        </p>
      ) : null}

      {/* Desktop action. Below `lg` the sticky bar owns it, so there is exactly
          one Continue on screen at any width. */}
      <div className="hidden flex-col items-end gap-2 lg:flex">
        <Button
          size="lg"
          onClick={advance}
          disabled={!chosen || totals.overAvailable}
          className={CTA_PILL_LG}
        >
          Continue
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        {!chosen && tiers.length ? (
          <p className="text-caption text-muted-foreground">Add at least one ticket to continue.</p>
        ) : null}
      </div>

      <StickyActionBar
        className="lg:hidden"
        total={totals.total}
        caption={
          chosen
            ? `${totals.ticketCount} ticket${totals.ticketCount === 1 ? '' : 's'} · ${formatFromPrice(totals.total)}`
            : 'No tickets chosen'
        }
      >
        <Button
          size="lg"
          onClick={advance}
          disabled={!chosen || totals.overAvailable}
          className={cn(CTA_PILL_LG, 'shrink-0')}
        >
          Continue
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </StickyActionBar>
      <AuthSheet
        open={authOpen}
        onOpenChange={setAuthOpen}
        // Straight on to review — the press that opened this sheet was a press
        // of Continue, and answering an interruption should not cost the
        // action that raised it.
        onAuthenticated={() => {
          setAuthOpen(false);
          router.push(reviewHref);
        }}
        // Where an OAuth round trip returns to: the same place, with the same
        // selection, so a trip out to Google does not empty the basket.
        next={reviewHref}
      />
    </StepTransition>
  );
}
