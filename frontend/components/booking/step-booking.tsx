'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AuthSheet } from '@/components/auth/auth-sheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { SELECTION_PARAM, serialiseSelection } from '@/lib/booking/selection';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG } from './cta';
import { useBooking } from './booking-context';
import { EventSubtitle, FunnelScreen } from './funnel-shell';
import { Rise, StepTransition } from './motion';
import { StickyActionBar } from './sticky-action-bar';
import { TierPicker } from './tier-picker';

/**
 * Screen 1 — choose tickets.
 *
 * ── THE TIERS ARE THE SCREEN ──────────────────────────────────────────────
 *
 * This used to open with an `h1`, a paragraph about live availability, and —
 * above all of it, from the layout — a persistent order-summary card repeating
 * the poster, title, date and venue. Measured on a phone, the first ticket tier
 * sat below the fold: you could not see a single thing you had come here to buy
 * without scrolling.
 *
 * The heading is now the header's own (the event's name, its date and its
 * city), and the tiers begin immediately under a two-word `Choose tickets`.
 *
 * ── WHAT WAS REMOVED, AND WHY EACH ────────────────────────────────────────
 *
 * "Where your tickets go" restated the signed-in account's name and email on
 * the screen BEFORE the one that shows exactly that under a Delivery heading
 * with an Edit control. Two copies, and only one of them editable.
 *
 * The trust strip (encrypted payment, instant QR, one scan at the gate) is
 * reassurance about PAYING, on the screen where nobody has decided to pay yet.
 * It is on the review screen, next to the button that takes money.
 *
 * The desktop-only Continue button is gone; the action bar is the one primary
 * control at every width. Two live buttons doing the same thing is two places a
 * double-tap can fire from.
 *
 * ── SIGNING IN IS AN INTERRUPTION, NOT A STEP ─────────────────────────────
 *
 * An anonymous Continue opens a sheet OVER this screen rather than pushing
 * `/booking/{id}/login`. The tickets stay chosen and stay visible behind the
 * scrim, and the moment a session exists the flow continues to review from
 * exactly where it paused.
 */
export function BookingStep() {
  const { event, selection, totals, tiers } = useBooking();
  const { status } = useAuth();
  const router = useRouter();

  const chosen = totals.ticketCount > 0;
  const query = selection.length ? `?${SELECTION_PARAM}=${serialiseSelection(selection)}` : '';
  const reviewHref = `/booking/${event.id}/review${query}`;

  const [authOpen, setAuthOpen] = React.useState(false);
  const advance = () => {
    if (status === 'authenticated') router.push(reviewHref);
    else setAuthOpen(true);
  };

  return (
    <FunnelScreen title={event.title} subtitle={<EventSubtitle event={event} />}>
      <StepTransition stepKey="booking" className="flex flex-col gap-4">
        <Rise>
          {/* `h2`, because the screen's `h1` is the event's name in the header.
              A checkout with two competing top-level headings has no outline. */}
          <h2 className="text-h3 font-semibold">Choose tickets</h2>
        </Rise>

        <Rise index={1}>
          <TierPicker />
        </Rise>

        {totals.overAvailable ? (
          <Rise index={2}>
            <p
              role="alert"
              className="rounded-xl border border-destructive-subtle bg-destructive-subtle p-card text-body-sm text-destructive-subtle-foreground"
            >
              Some tiers no longer have that many left — adjust the quantities to continue.
            </p>
          </Rise>
        ) : null}

        {/* Nothing is reserved until the next screen, and saying so HERE is
            what stops the countdown that appears there reading as a trick. One
            line, at the foot of the list, where somebody has finished choosing
            rather than before they have started. */}
        {tiers.length ? (
          <Rise index={3}>
            <p className="px-1 text-caption text-muted-foreground">
              Availability updates live. Nothing is held until the next step.
            </p>
          </Rise>
        ) : null}
      </StepTransition>

      <StickyActionBar
        total={totals.total}
        caption={
          chosen
            ? `${totals.ticketCount} ${totals.ticketCount === 1 ? 'ticket' : 'tickets'}`
            : 'No tickets chosen'
        }
      >
        {/* "Checkout", not "Continue". At this point the next screen is the
            last one — it reviews AND takes the payment — so naming the
            destination is more honest than naming the direction. */}
        <Button
          size="lg"
          onClick={advance}
          disabled={!chosen || totals.overAvailable}
          className={cn(CTA_PILL_LG, 'shrink-0')}
        >
          Checkout
        </Button>
      </StickyActionBar>

      <AuthSheet
        open={authOpen}
        onOpenChange={setAuthOpen}
        // Straight on to review — the press that opened this sheet was a press
        // of Checkout, and answering an interruption should not cost the action
        // that raised it.
        onAuthenticated={() => {
          setAuthOpen(false);
          router.push(reviewHref);
        }}
        // Where an OAuth round trip returns to: the same place, with the same
        // selection, so a trip out to Google does not empty the basket.
        next={reviewHref}
      />
    </FunnelScreen>
  );
}
