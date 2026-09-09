'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AuthSheet } from '@/components/auth/auth-sheet';
import { Button } from '@/components/ui/button';
import { cancelBooking } from '@/lib/api/bookings';
import { useAuth } from '@/lib/auth/auth-provider';
import { SELECTION_PARAM, serialiseSelection } from '@/lib/booking/selection';
import { cn } from '@/lib/utils/cn';
import { CTA_PILL_LG } from './cta';
import { useBooking } from './booking-context';
import { EventSubtitle, FunnelScreen } from './funnel-shell';
import { Rise, StepTransition } from './motion';
import { StickyActionBar } from './sticky-action-bar';
import { TierPicker } from './tier-picker';
import { SessionPicker } from '@/components/event/session-picker';
import { Questionnaire } from './questionnaire';

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
  const {
    event,
    selection,
    totals,
    tiers,
    booking,
    setBooking,
    query,
    sessionDays,
    session,
    setSession,
    unanswered,
  } = useBooking();
  // Nothing is marked wrong until somebody tries to leave — a required
  // question is not a mistake on arrival.
  const [showAnswerErrors, setShowAnswerErrors] = React.useState(false);
  const { status } = useAuth();
  const router = useRouter();

  /**
   * ── A HOLD MUST NOT SURVIVE A TRIP BACK TO THIS SCREEN ──────────────────
   *
   * This is the invariant that makes a whole class of bug impossible rather
   * than merely fixed: **inventory is held only while the review screen is
   * open.** Arriving here with a booking in context means the customer has gone
   * back to edit their order, and the hold they left behind describes an order
   * they are in the middle of changing.
   *
   * It is not a new rule — it is the one this funnel already states. Reserving
   * on the review step rather than here is deliberate "because holding stock
   * while someone is still browsing tiers would take tickets off sale for
   * people who are ready to buy". A hold that lingers on this screen is that
   * same harm, arrived at from the other direction.
   *
   * ── WHAT IT FIXES, MEASURED ─────────────────────────────────────────────
   *
   * Change the quantity, press Continue, and the review screen showed the new
   * line items beside the OLD booking's fee and total — one step behind on
   * every edit (5 -> fee of 3, 6 -> fee of 5, 3 -> fee of 6). The screen's own
   * guard was supposed to catch it and could not. With the hold released here,
   * review always arrives with nothing to reconcile: it reserves fresh, for the
   * selection in the URL, every time.
   *
   * ── WHY THIS IS NOT AN UNMOUNT HOOK ─────────────────────────────────────
   *
   * Cancelling on unmount is forbidden in this funnel and for a good reason:
   * the review screen has `router.replace` guards for an anonymous visitor and
   * an empty selection, so an unmount cleanup would silently cancel bookings on
   * paths that were never a customer leaving. This runs on MOUNT of the screen
   * where a hold is wrong, which is a fact about the screen rather than a guess
   * about why it was rendered.
   *
   * Fire-and-forget: a 409 means the sweeper or another tab already released
   * it, which is the outcome the call wanted. `releasing` guards re-entry,
   * including React's double-invoked effects in development.
   */
  const releasing = React.useRef(false);
  React.useEffect(() => {
    if (!booking || releasing.current) return;
    releasing.current = true;
    const dead = booking;
    // Cleared FIRST, so the picker never renders against a hold it is
    // discarding and the review step cannot be re-entered against it mid-flight.
    setBooking(null);
    void cancelBooking(dead.id)
      .catch(() => undefined)
      .finally(() => {
        releasing.current = false;
      });
  }, [booking, setBooking]);

  const chosen = totals.ticketCount > 0;
  // ── THE HREF IS BUILT FROM THE WHOLE QUERY, NOT FROM THE SELECTION ──────
  //
  // It used to be `?tickets=${serialiseSelection(selection)}`, which discards
  // every other param. `writeSelection` preserves foreign params, so `session=`
  // survived a quantity tap and then vanished on Checkout — an intermittent
  // loss that reads as the picker resetting itself rather than as a routing
  // bug. Anything else the funnel ever puts in the URL is now carried too.
  const params = new URLSearchParams(query);
  const encoded = serialiseSelection(selection);
  if (encoded) params.set(SELECTION_PARAM, encoded);
  else params.delete(SELECTION_PARAM);
  const search = params.toString();
  const reviewHref = `/booking/${event.id}/review${search ? `?${search}` : ''}`;

  const [authOpen, setAuthOpen] = React.useState(false);
  const advance = () => {
    // ── THE QUESTIONNAIRE IS CHECKED BEFORE LEAVING THIS SCREEN ──────────
    //
    // The server refuses the reserve without the required answers anyway, and
    // that refusal would land on the NEXT screen — the one with no form on it.
    // Blocking here is what keeps the fix reachable from where the mistake is.
    if (unanswered.length > 0) {
      setShowAnswerErrors(true);
      return;
    }
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

        {/* ── THE SHOWTIME, ABOVE THE TIERS IT FILTERS ──────────────────
            Absent for the single-show events that are most of them, and the
            component returns null on an empty list rather than drawing a
            control with one option in it.

            It is HERE and not on the event page: `BookingCta` is forbidden
            from growing a tier list or a quantity control (the ASK ONCE
            invariant), and a session picker without the tiers it filters
            would be asking half a question in one place and half in another. */}
        {sessionDays.length > 0 && session ? (
          <Rise index={1}>
            <SessionPicker days={sessionDays} selected={session} onSelect={setSession} />
          </Rise>
        ) : null}

        <Rise index={sessionDays.length > 0 ? 2 : 1}>
          <TierPicker />
        </Rise>

        {/* AFTER the tiers: what somebody is buying comes before what the
            organiser needs to know about them. Renders nothing at all for the
            great majority of events, which ask nothing. */}
        <Rise index={sessionDays.length > 0 ? 3 : 2}>
          <Questionnaire showErrors={showAnswerErrors} />
        </Rise>

        {totals.overAvailable ? (
          <Rise index={2}>
            <p
              role="alert"
              className="rounded-xl border border-border bg-muted p-card text-body-sm text-foreground"
            >
              Some tiers no longer have that many left — adjust the quantities to continue.
            </p>
          </Rise>
        ) : null}

        {/* ── A BASKET THE SALE WINDOW HAS NOT OPENED FOR ───────────────
            Reachable only by URL — the picker draws these rows disabled —
            and by URL is exactly how it happened: the event page's panel
            writes `?tickets=<tier>:<qty>`, and that link outlives the day
            it was made. Blocking here is what keeps the reserve from
            answering `sale_not_started` on the screen after this one, which
            has no picker on it to fix anything with. */}
        {totals.notOnSale ? (
          <Rise index={2}>
            <p
              role="alert"
              className="rounded-xl border border-border bg-muted p-card text-body-sm text-foreground"
            >
              Those tickets are not on sale yet. Clear them to continue, or come back when booking
              opens.
            </p>
          </Rise>
        ) : null}

        {/* One booking cannot admit somebody to two evenings, and the server
            cannot refuse it — `POST /bookings` receives tier ids and nothing
            about sessions. So the guard has to be here, and it has to BLOCK
            rather than warn: a basket spanning two showtimes that reaches
            payment issues tickets to a show the buyer did not choose. */}
        {totals.crossSession ? (
          <Rise index={2}>
            <p
              role="alert"
              className="rounded-xl border border-border bg-muted p-card text-body-sm text-foreground"
            >
              Those tickets are for different showtimes. Pick one session — a single booking admits
              you to one show.
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
          disabled={!chosen || totals.overAvailable || totals.crossSession || totals.notOnSale}
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
